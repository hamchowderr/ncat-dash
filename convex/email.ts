import {
  checkKey,
  DEFAULT_APP_NAME,
  failureText,
  isEmailAddress,
  runFailedEmail,
  sendEmail,
  senderProblem,
  testEmail,
  type SendResult,
} from "@ncat-dash/email";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { getEdition } from "./lib/edition";

// Email goes out through toSend (https://tosend.com). There is one sending account for
// the whole dashboard, because sign-in emails are sent before anyone is on a team. It is
// set once: in Settings (kept in `emailConnections`, key encrypted), or by whoever runs
// the deployment with TOSEND_API_KEY and EMAIL_FROM, which win when both are present.

const outcome = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), detail: v.string() }),
);

type Sending = { apiKey: string; fromEmail: string; fromName: string; saved: boolean };

function fromEnvironment(): Omit<Sending, "saved"> | null {
  const apiKey = process.env.TOSEND_API_KEY?.trim();
  const fromEmail = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !fromEmail) return null;
  return { apiKey, fromEmail, fromName: process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_APP_NAME };
}

/** Only for tests: points the app at a stand-in for toSend. */
const apiBase = () => process.env.TOSEND_API_URL?.trim() || undefined;

/** Whether email is set up at all. Public: the sign-in page asks before offering a reset. */
export const status = query({
  args: {},
  returns: v.object({ configured: v.boolean() }),
  handler: async (ctx) => {
    if (fromEnvironment()) return { configured: true };
    return { configured: (await ctx.db.query("emailConnections").first()) !== null };
  },
});

/** How email is set up, for the Settings page, and whether the person asking gets alert emails. */
export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const preference = await ctx.db
      .query("emailPreferences")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .first();
    const alertEmails = preference?.runFailed ?? true;
    const environment = fromEnvironment();
    if (environment) {
      return {
        configured: true,
        source: "deployment" as const,
        fromEmail: environment.fromEmail,
        fromName: environment.fromName,
        apiKeyHint: null,
        failing: null,
        canEdit: false,
        alertEmails,
      };
    }
    const saved = await ctx.db.query("emailConnections").first();
    // The hosted edition sends from the operator's account, so teams there set nothing.
    const mayManage = getEdition() === "self-hosted" && MANAGER_ROLES.includes(role);
    if (!saved) {
      return {
        configured: false,
        source: null,
        fromEmail: null,
        fromName: null,
        apiKeyHint: null,
        failing: null,
        canEdit: mayManage,
        alertEmails,
      };
    }
    const own = saved.organizationId === args.organizationId;
    return {
      configured: true,
      source: own ? ("settings" as const) : ("deployment" as const),
      fromEmail: saved.fromEmail,
      fromName: saved.fromName ?? DEFAULT_APP_NAME,
      apiKeyHint: own ? saved.apiKeyHint : null,
      failing: own && saved.status === "failing" ? saved.lastError : null,
      canEdit: mayManage && own,
      alertEmails,
    };
  },
});

/**
 * Checks a toSend key and sending address and, when both are good, saves them with the
 * key encrypted. Leaving the key empty keeps the saved one. Owners and admins only.
 */
export const connect = action({
  args: {
    organizationId: v.string(),
    apiKey: v.string(),
    fromEmail: v.string(),
    fromName: v.string(),
  },
  returns: outcome,
  handler: async (ctx, args) => {
    const { userId, saved } = await ctx.runQuery(internal.email.authorize, {
      organizationId: args.organizationId,
    });
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const fromName = args.fromName.trim().slice(0, 60);
    if (!isEmailAddress(fromEmail)) {
      return {
        ok: false as const,
        detail: "Enter one email address, such as alerts@yourdomain.com.",
      };
    }
    const typed = args.apiKey.trim();
    const apiKey = typed || (saved ? await decryptSecret(saved.apiKeyCipher) : "");
    if (!apiKey) return { ok: false as const, detail: "Enter your toSend API key." };

    const check = await checkKey(apiKey, {
      signal: AbortSignal.timeout(15_000),
      baseUrl: apiBase(),
    });
    if (!check.ok) {
      return {
        ok: false as const,
        detail:
          check.reason === "unauthorized"
            ? "toSend did not accept this API key. Copy a sending key from your toSend dashboard."
            : "toSend could not be reached. Try again in a minute.",
      };
    }
    const problem = senderProblem(fromEmail, check.domains);
    if (problem) return { ok: false as const, detail: problem };

    await ctx.runMutation(internal.email.save, {
      organizationId: args.organizationId,
      apiKeyCipher: typed ? await encryptSecret(apiKey) : saved!.apiKeyCipher,
      apiKeyHint: apiKey.slice(-4),
      fromEmail,
      fromName: fromName || undefined,
      createdBy: userId,
    });
    return { ok: true as const };
  },
});

/** Sends a test email to the person asking. Owners and admins only. */
export const sendTest = action({
  args: { organizationId: v.string() },
  returns: outcome,
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.email.authorizeTest, {
      organizationId: args.organizationId,
    });
    const sending = await loadSending(ctx);
    if (!sending) return { ok: false as const, detail: "Email is not set up yet." };
    const [me, team] = await Promise.all([
      ctx.runQuery(components.betterAuth.members.contact, { userId }),
      ctx.runQuery(components.betterAuth.members.contactsFor, {
        organizationId: args.organizationId,
      }),
    ]);
    if (!me) return { ok: false as const, detail: "Your account has no email address." };
    const result = await deliver(ctx, sending, {
      to: me.email,
      ...testEmail({ teamName: team.teamName ?? undefined }, { appName: sending.fromName }),
    });
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, detail: failureText(result.reason, result.detail) };
  },
});

/** Forgets the saved toSend account. Email stops until one is saved again. */
export const remove = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const saved = await ctx.db.query("emailConnections").first();
    if (!saved || saved.organizationId !== args.organizationId) return;
    await ctx.db.delete(saved._id);
  },
});

/** Each member chooses for themselves whether failed runs are emailed to them. */
export const setAlertEmails = mutation({
  args: { organizationId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const existing = await ctx.db
      .query("emailPreferences")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { runFailed: args.enabled });
    else {
      await ctx.db.insert("emailPreferences", {
        organizationId: args.organizationId,
        userId,
        runFailed: args.enabled,
      });
    }
  },
});

// Internal: only reachable from the actions above, the runner and sign-in.

/** Sends one email. Does nothing, quietly, when email is not set up. */
export const send = internalAction({
  args: { to: v.string(), subject: v.string(), text: v.string(), html: v.string() },
  handler: async (ctx, args) => {
    const sending = await loadSending(ctx);
    if (!sending) {
      console.warn(`Email is not set up, so "${args.subject}" was not sent.`);
      return;
    }
    await deliver(ctx, sending, args);
  },
});

/** Emails a failed run to every member of the team who has not switched that off. */
export const sendRunFailed = internalAction({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const sending = await loadSending(ctx);
    if (!sending) return;
    const found = await ctx.runQuery(internal.email.alertRecipients, { alertId: args.alertId });
    if (!found) return;
    const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
    const { alert } = found;
    const composed = runFailedEmail(
      {
        teamName: found.teamName ?? undefined,
        automationName: alert.automationName,
        stepName: alert.stepName,
        message: alert.message,
        retries: alert.retries,
        runUrl: `${site}/automations/${alert.automationId}/runs/${alert.runId}`,
        settingsUrl: `${site}/settings`,
      },
      { appName: sending.fromName },
    );
    for (const to of found.recipients) {
      const result = await deliver(ctx, sending, { to, ...composed });
      // A bad key, an unpaid account or an unverified domain fails for everyone alike.
      if (!result.ok && ["unauthorized", "billing", "domain"].includes(result.reason)) break;
    }
  },
});

export const authorize = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const refuse = (message: string) => new ConvexError({ code: "forbidden", message });
    if (getEdition() !== "self-hosted" || fromEnvironment()) {
      throw refuse("Email for this dashboard is set by whoever runs it.");
    }
    const saved = await ctx.db.query("emailConnections").first();
    if (saved && saved.organizationId !== args.organizationId) {
      throw refuse("Email for this dashboard was set up by another team.");
    }
    return { userId, saved: saved ? { apiKeyCipher: saved.apiKeyCipher } : null };
  },
});

export const authorizeTest = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await requireMember(ctx, args.organizationId, MANAGER_ROLES);
  },
});

export const saved = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("emailConnections").first();
  },
});

export const alertRecipients = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert) return null;
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: alert.organizationId,
    });
    const recipients: string[] = [];
    for (const member of team.members) {
      const preference = await ctx.db
        .query("emailPreferences")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", alert.organizationId).eq("userId", member.userId),
        )
        .first();
      if (preference?.runFailed ?? true) recipients.push(member.email);
    }
    return { alert, teamName: team.teamName, recipients };
  },
});

export const save = internalMutation({
  args: {
    organizationId: v.string(),
    apiKeyCipher: v.string(),
    apiKeyHint: v.string(),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const fields = { ...args, status: "ok" as const, lastError: null };
    const existing = await ctx.db.query("emailConnections").first();
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("emailConnections", fields);
  },
});

export const recordOutcome = internalMutation({
  args: { error: v.union(v.null(), v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("emailConnections").first();
    if (!existing) return;
    const next = args.error ? ("failing" as const) : ("ok" as const);
    if (existing.status === next && existing.lastError === args.error) return;
    await ctx.db.patch(existing._id, { status: next, lastError: args.error });
  },
});

async function loadSending(ctx: ActionCtx): Promise<Sending | null> {
  const environment = fromEnvironment();
  if (environment) return { ...environment, saved: false };
  const row = await ctx.runQuery(internal.email.saved, {});
  if (!row) return null;
  return {
    apiKey: await decryptSecret(row.apiKeyCipher),
    fromEmail: row.fromEmail,
    fromName: row.fromName ?? DEFAULT_APP_NAME,
    saved: true,
  };
}

/** Sends, and keeps the saved connection's state in step so Settings can say what is wrong. */
async function deliver(
  ctx: ActionCtx,
  sending: Sending,
  message: { to: string; subject: string; text: string; html: string },
): Promise<SendResult> {
  const result = await sendEmail(
    sending.apiKey,
    { email: sending.fromEmail, name: sending.fromName },
    message,
    { signal: AbortSignal.timeout(20_000), baseUrl: apiBase() },
  );
  if (!result.ok) console.error(`Email "${message.subject}" was not sent: ${result.detail}`);
  // A busy moment or one refused address says nothing about the setup.
  const lasting = !result.ok && ["unauthorized", "billing", "domain"].includes(result.reason);
  if (sending.saved && (result.ok || lasting)) {
    await ctx.runMutation(internal.email.recordOutcome, {
      error: result.ok ? null : failureText(result.reason, result.detail),
    });
  }
  return result;
}
