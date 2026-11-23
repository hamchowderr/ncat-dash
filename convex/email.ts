import { explainFailure } from "@ncat-dash/automation-core";
import {
  checkKey,
  DEFAULT_APP_NAME,
  failureText,
  isEmailAddress,
  runFailedEmail,
  approvalWaitingEmail,
  approvalTimedOutEmail,
  digestEmail,
  type DigestItem,
  clientFeedbackEmail,
  clipFinishedEmail,
  footageProblemEmail,
  rightsEndingEmail,
  readyForReviewEmail,
  mentionEmail,
  agentAnswerEmail,
  sendEmail,
  senderProblem,
  testEmail,
  trialEndedEmail,
  trialEndingEmail,
  welcomeEmail,
  withUnsubscribe,
  type Composed,
  type SendResult,
} from "@ncat-dash/email";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { getEdition } from "./lib/edition";
import { isFor } from "./lib/alerts";
import { buyUrl } from "./lib/trial";
import {
  readUnsubscribeToken,
  unsubscribeToken,
  unsubscribeUrl,
  type UnsubscribeScope,
} from "./lib/unsubscribe";
import {
  alertHref,
  emailsRightAway,
  NOTIFICATION_KINDS,
  preferenceOf,
  wants,
} from "./lib/notifications";

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
  handler: async (ctx) => ({ configured: await emailConfigured(ctx) }),
});

/** Whether the dashboard can send email: set by whoever runs it, or saved in Settings. */
export async function emailConfigured(ctx: QueryCtx): Promise<boolean> {
  if (fromEnvironment()) return true;
  return (await ctx.db.query("emailConnections").first()) !== null;
}

/**
 * How email is set up, for the Settings page. Which emails each member gets is in their
 * notification settings (convex/notifications.ts).
 */
export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
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
      timeoutMs: 15_000,
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

/** Where a link in an email goes, on this dashboard's own address. */
function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

const SETTINGS_PATH = "/settings/notifications";

/**
 * Emails an alert straight away to the members it is for who want that kind by email.
 * Members who chose a daily summary get it in that instead (`sendDigest`), except for
 * approvals waiting, which have a deadline.
 */
export const sendAlert = internalAction({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const sending = await loadSending(ctx);
    if (!sending) return;
    const found = await ctx.runQuery(internal.email.alertRecipients, { alertId: args.alertId });
    if (!found || found.recipients.length === 0) return;
    const { alert } = found;
    const link = siteUrl(alertHref(alert));
    const settingsUrl = siteUrl(SETTINGS_PATH);
    const teamName = found.teamName ?? undefined;
    const branding = { appName: sending.fromName };
    const composed =
      alert.kind === "approval_waiting"
        ? approvalWaitingEmail(
            {
              teamName,
              automationName: alert.automationName,
              stepName: alert.stepName,
              note: alert.message,
              runUrl: link,
              settingsUrl,
            },
            branding,
          )
        : alert.kind === "approval_timed_out"
          ? approvalTimedOutEmail(
              {
                teamName,
                automationName: alert.automationName,
                stepName: alert.stepName,
                outcome: alert.message,
                runUrl: link,
                settingsUrl,
              },
              branding,
            )
          : alert.kind === "mention"
            ? mentionEmail(
                {
                  teamName,
                  from: alert.from ?? "Someone",
                  reviewTitle: alert.automationName,
                  comment: alert.message,
                  reviewUrl: link,
                  settingsUrl,
                },
                branding,
              )
            : alert.kind === "agent_answer"
              ? agentAnswerEmail(
                  {
                    teamName,
                    reviewTitle: alert.automationName,
                    answer: alert.message,
                    reviewUrl: link,
                    settingsUrl,
                  },
                  branding,
                )
              : alert.kind === "ready_for_review"
                ? readyForReviewEmail(
                    {
                      teamName,
                      from: alert.from ?? "Someone",
                      projectName: alert.automationName,
                      slot: alert.stepName ?? "A deliverable",
                      reviewUrl: link,
                      settingsUrl,
                    },
                    branding,
                  )
                : alert.kind === "footage_problem"
                  ? footageProblemEmail(
                      {
                        teamName,
                        automationName: alert.automationName,
                        message: alert.message,
                        runUrl: link,
                        settingsUrl,
                      },
                      branding,
                    )
                  : alert.kind === "rights_ending"
                    ? rightsEndingEmail(
                        {
                          teamName,
                          creator: alert.automationName,
                          client: alert.stepName,
                          summary: alert.message,
                          creatorsUrl: link,
                          settingsUrl,
                        },
                        branding,
                      )
                    : alert.kind === "clip_finished"
                      ? clipFinishedEmail(
                          {
                            teamName,
                            automationName: alert.automationName,
                            summary: alert.message,
                            runUrl: link,
                            settingsUrl,
                          },
                          branding,
                        )
                      : alert.kind === "client_feedback"
                        ? clientFeedbackEmail(
                            {
                              teamName,
                              from: alert.from ?? "A client",
                              reviewTitle: alert.automationName,
                              feedback: alert.message,
                              reviewUrl: link,
                              settingsUrl,
                            },
                            branding,
                          )
                        : runFailedEmail(
                            {
                              teamName,
                              automationName: alert.automationName,
                              stepName: alert.stepName,
                              message: explainFailure(alert.message).reason,
                              retries: alert.retries,
                              runUrl: link,
                              settingsUrl,
                            },
                            branding,
                          );
    for (const person of found.people) {
      const result = await deliver(ctx, sending, {
        to: person.email,
        ...(await optOut(composed, person.userId, alert.organizationId, alert.kind)),
      });
      // A bad key, an unpaid account or an unverified domain fails for everyone alike.
      if (!result.ok && ["unauthorized", "billing", "domain"].includes(result.reason)) break;
    }
  },
});

/**
 * Sends one member their daily summary of what they chose to hear about by email since
 * the last one. Booked by `notifications.bookDigests`, which has already moved the
 * member's `lastDigestAt` on, so a summary is never sent twice.
 */
export const sendDigest = internalAction({
  args: { preferenceId: v.id("notificationPreferences"), since: v.number(), until: v.number() },
  handler: async (ctx, args) => {
    const sending = await loadSending(ctx);
    if (!sending) return;
    const found = await ctx.runQuery(internal.email.digestFor, args);
    if (!found || found.items.length === 0) return;
    const summary = digestEmail(
      {
        teamName: found.teamName ?? undefined,
        items: found.items,
        settingsUrl: siteUrl(SETTINGS_PATH),
      },
      { appName: sending.fromName },
    );
    await deliver(ctx, sending, {
      to: found.email,
      ...(await optOut(summary, found.userId, found.organizationId, "all")),
    });
  },
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * Welcomes someone who just made a team, unless it is not their first: one welcome per
 * person. Booked by `afterCreateOrganization` in auth.ts a few seconds after the team is
 * made, so the trial it mentions has started.
 */
export const sendWelcome = internalAction({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const sending = await loadSending(ctx);
    if (!sending) return;
    const found = await ctx.runQuery(internal.email.welcomeFor, args);
    if (!found) return;
    await deliver(ctx, sending, {
      to: found.email,
      ...welcomeEmail(
        {
          name: found.name || undefined,
          teamName: found.teamName,
          trialDays: found.trialDays,
          homeUrl: siteUrl("/"),
          uploadsUrl: siteUrl("/uploads"),
          readyMadeUrl: siteUrl("/automations/new"),
          brandUrl: siteUrl("/settings/brand"),
        },
        { appName: sending.fromName },
      ),
    });
  },
});

export const welcomeFor = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const teams = await ctx.runQuery(components.betterAuth.members.teamsFor, {
      userId: args.userId,
    });
    const team = teams.find((candidate) => candidate.id === args.organizationId);
    if (!team || teams.length > 1) return null;
    const person = await ctx.runQuery(components.betterAuth.members.contact, {
      userId: args.userId,
    });
    if (!person) return null;
    const trial = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const fresh = trial && trial.repeatOf === undefined && trial.paidAt === undefined;
    return {
      email: person.email,
      name: person.name,
      teamName: team.name,
      trialDays: fresh ? Math.max(1, Math.round((trial.endsAt - trial.startedAt) / DAY)) : null,
    };
  },
});

/**
 * Tells a team's owner their free trial ends tomorrow, or has ended. Booked by
 * `trial.begin` for the moment it was set to end; does nothing when the team has bought
 * since, or its trial was moved.
 */
export const sendTrialReminder = internalAction({
  args: {
    organizationId: v.string(),
    endsAt: v.number(),
    kind: v.union(v.literal("ending"), v.literal("ended")),
  },
  handler: async (ctx, args) => {
    const sending = await loadSending(ctx);
    if (!sending) return;
    const found = await ctx.runQuery(internal.email.trialReminderFor, {
      organizationId: args.organizationId,
      endsAt: args.endsAt,
    });
    if (!found) return;
    const details = {
      name: found.name || undefined,
      teamName: found.teamName,
      buyUrl: buyUrl(),
      homeUrl: siteUrl("/"),
    };
    const branding = { appName: sending.fromName };
    await deliver(ctx, sending, {
      to: found.email,
      ...(args.kind === "ending"
        ? trialEndingEmail(details, branding)
        : trialEndedEmail(details, branding)),
    });
  },
});

export const trialReminderFor = internalQuery({
  args: { organizationId: v.string(), endsAt: v.number() },
  handler: async (ctx, args) => {
    const trial = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!trial || trial.paidAt !== undefined || trial.endsAt !== args.endsAt) return null;
    if (!trial.ownerId) return null;
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: args.organizationId,
    });
    const owner = team.members.find((member) => member.userId === trial.ownerId);
    if (!owner || !team.teamName) return null;
    return { email: owner.email, name: owner.name, teamName: team.teamName };
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

/** The addresses an alert is emailed to straight away. */
export const alertRecipients = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert) return null;
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: alert.organizationId,
    });
    const people: { email: string; userId: string }[] = [];
    for (const member of team.members) {
      if (!isFor(alert, member.userId)) continue;
      const preference = await preferenceOf(ctx, alert.organizationId, member.userId);
      if (!wants(preference, alert.kind, "email")) continue;
      if (!emailsRightAway(preference, alert.kind)) continue;
      people.push({ email: member.email, userId: member.userId });
    }
    return {
      alert,
      teamName: team.teamName,
      recipients: people.map((person) => person.email),
      people,
    };
  },
});

/** What goes in one member's daily summary, and where it is sent. */
export const digestFor = internalQuery({
  args: { preferenceId: v.id("notificationPreferences"), since: v.number(), until: v.number() },
  handler: async (ctx, args) => {
    const preference = await ctx.db.get(args.preferenceId);
    if (!preference) return null;
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: preference.organizationId,
    });
    const member = team.members.find((candidate) => candidate.userId === preference.userId);
    if (!member) return null;
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_organization", (q) =>
        q
          .eq("organizationId", preference.organizationId)
          .gt("_creationTime", args.since)
          .lte("_creationTime", args.until),
      )
      .take(500);
    const items: DigestItem[] = [];
    for (const alert of alerts) {
      if (!isFor(alert, member.userId)) continue;
      if (!wants(preference, alert.kind, "email")) continue;
      // Those were emailed when they happened.
      if (emailsRightAway(preference, alert.kind)) continue;
      items.push({ ...digestLine(alert), url: siteUrl(alertHref(alert)) });
    }
    return {
      email: member.email,
      userId: member.userId,
      organizationId: preference.organizationId,
      teamName: team.teamName,
      items,
    };
  },
});

function digestLine(alert: Doc<"alerts">): Omit<DigestItem, "url"> {
  switch (alert.kind) {
    case "mention":
      return {
        title: `${alert.from ?? "Someone"} mentioned you in ${alert.automationName}`,
        detail: alert.message,
      };
    case "agent_answer":
      return {
        title: `The agent answered you in ${alert.automationName}`,
        detail: alert.message,
      };
    case "ready_for_review":
      return {
        title: `${alert.stepName ?? "A deliverable"} in ${alert.automationName} is ready for review`,
      };
    case "client_feedback":
      return {
        title: `${alert.from ?? "A client"} left feedback on ${alert.automationName}`,
        detail: alert.message,
      };
    case "approval_timed_out":
      return {
        title: `${alert.automationName}: an approval ran out of time`,
        detail: alert.message,
      };
    case "clip_finished":
      return { title: `${alert.automationName} finished`, detail: alert.message };
    case "footage_problem":
      return {
        title: `${alert.automationName}: footage needs another look`,
        detail: alert.message.split("\n")[0],
      };
    case "rights_ending":
      return {
        title: alert.stepName
          ? `${alert.automationName}'s rights for ${alert.stepName} end soon`
          : `Usage rights for ${alert.automationName} end soon`,
        detail: alert.message,
      };
    case "approval_waiting":
      return {
        title: `${alert.automationName} is waiting for your approval`,
        detail: alert.message,
      };
    default:
      return {
        title: `${alert.automationName} failed`,
        detail: `${alert.stepName ? `${alert.stepName}: ` : ""}${explainFailure(alert.message).reason}`,
      };
  }
}

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

/** An email people can opt out of, with its one-click unsubscribe for this person. */
async function optOut(
  email: Composed,
  userId: string,
  organizationId: string,
  scope: UnsubscribeScope,
): Promise<Composed> {
  if (!process.env.CONVEX_SITE_URL || !process.env.BETTER_AUTH_SECRET) return email;
  const token = await unsubscribeToken({ userId, organizationId, scope });
  return withUnsubscribe(email, unsubscribeUrl(token));
}

/**
 * Switches off what an unsubscribe link names: one kind of email, or every alert email
 * (the daily summary's link). Under the bell nothing changes. Returns what was switched
 * off, or null for a link we did not sign.
 */
export const unsubscribe = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const target = await readUnsubscribeToken(args.token);
    if (!target) return null;
    const existing = await preferenceOf(ctx, target.organizationId, target.userId);
    const kinds = { ...existing?.kinds };
    const names =
      target.scope === "all" ? NOTIFICATION_KINDS.map((entry) => entry.kind) : [target.scope];
    for (const name of names) kinds[name] = { ...kinds[name], email: false };
    if (existing) await ctx.db.patch(existing._id, { kinds });
    else
      await ctx.db.insert("notificationPreferences", {
        organizationId: target.organizationId,
        userId: target.userId,
        kinds,
      });
    return {
      scope: target.scope,
      title:
        target.scope === "all"
          ? null
          : (NOTIFICATION_KINDS.find((entry) => entry.kind === target.scope)?.title ?? null),
    };
  },
});

/** Keeps what toSend reported about an address: the latest bounce or spam complaint. */
export const recordProblem = internalMutation({
  args: {
    email: v.string(),
    kind: v.union(v.literal("bounced"), v.literal("complaint")),
    permanent: v.boolean(),
    reason: v.string(),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const fields = { ...args, email, reason: args.reason.slice(0, 300) };
    const existing = await ctx.db
      .query("emailProblems")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("emailProblems", fields);
  },
});

/** Sends, and keeps the saved connection's state in step so Settings can say what is wrong. */
async function deliver(
  ctx: ActionCtx,
  sending: Sending,
  message: {
    to: string;
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  },
): Promise<SendResult> {
  const result = await sendEmail(
    sending.apiKey,
    { email: sending.fromEmail, name: sending.fromName },
    message,
    { timeoutMs: 20_000, baseUrl: apiBase() },
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
