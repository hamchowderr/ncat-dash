import { vOnCompleteArgs } from "@convex-dev/workpool";
import {
  announcementEmail,
  BATCH_LIMIT,
  confirmNewsEmail,
  DEFAULT_APP_NAME,
  failureText,
  sendBatch,
  sendEmail,
  withUnsubscribe,
  type AnnouncementAudience,
  type EmailMessage,
} from "@takewon/email";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { apiBase, loadSending } from "./email";
import { normalEmail } from "./lib/news";
import { newsToken, newsUrl } from "./lib/newsToken";
import { callerIsOperator, requireOperator } from "./lib/operator";
import { getCaller } from "./lib/caller";
import { backgroundPool } from "./lib/pools";

// The operator's own emails: product news to people who asked for it, and notices to
// account holders about their account or the service. Written on the Send An Email page,
// sent now or at a set time, a hundred at a time through toSend's batch call, each with
// its own one-click unsubscribe. Sent Emails shows how each one went.

const audience = v.union(
  v.literal("news"),
  v.literal("accounts"),
  v.literal("trial_teams"),
  v.literal("paid_teams"),
);
type Audience = Doc<"broadcasts">["audience"];

const draft = v.object({
  subject: v.string(),
  heading: v.optional(v.string()),
  body: v.string(),
  button: v.optional(v.object({ label: v.string(), url: v.string() })),
  audience,
});
type Draft = {
  subject: string;
  heading?: string;
  body: string;
  button?: { label: string; url: string };
  audience: Audience;
};

/** What the email calls the reason someone got it. Only "news" is marketing. */
const kindOf = (value: Audience): AnnouncementAudience => (value === "news" ? "news" : "accounts");

/** The address to print in the footer of other copies (ours prints Otaku Solutions'). */
const postalAddress = () => process.env.EMAIL_POSTAL_ADDRESS?.trim() || undefined;

function checkDraft(input: Draft): Draft {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) throw new ConvexError({ code: "invalid", message: "Write a subject." });
  if (subject.length > 150)
    throw new ConvexError({ code: "invalid", message: "Keep the subject under 150 characters." });
  if (!body) throw new ConvexError({ code: "invalid", message: "Write the email." });
  if (body.length > 20_000)
    throw new ConvexError({ code: "invalid", message: "That email is too long to send." });
  let button = input.button;
  if (button && (button.label.trim() || button.url.trim())) {
    if (!button.label.trim() || !/^https:\/\/\S+$/.test(button.url.trim())) {
      throw new ConvexError({
        code: "invalid",
        message: "A button needs a label and an https:// link.",
      });
    }
    button = { label: button.label.trim().slice(0, 60), url: button.url.trim() };
  } else button = undefined;
  return {
    subject,
    body,
    audience: input.audience,
    ...(input.heading?.trim() ? { heading: input.heading.trim().slice(0, 150) } : {}),
    ...(button ? { button } : {}),
  };
}

function compose(input: Draft, appName: string) {
  return announcementEmail(
    {
      subject: input.subject,
      body: input.body,
      ...(input.heading ? { heading: input.heading } : {}),
      ...(input.button ? { button: input.button } : {}),
    },
    kindOf(input.audience),
    { appName },
    appName === DEFAULT_APP_NAME ? {} : { postalAddress: postalAddress() },
  );
}

const fromName = () => process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_APP_NAME;

// ---- The Send An Email page ----

/** How many people each audience reaches today, and whether sending is set up. */
export const audiences = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const subscribed = await ctx.db
      .query("subscribers")
      .withIndex("by_status", (q) => q.eq("status", "subscribed"))
      .take(10_000);
    const accounts = await ctx.runQuery(components.betterAuth.members.accountCount, {});
    const trials = await ctx.db.query("teamTrials").take(5_000);
    const now = Date.now();
    const onTrial = trials.filter((trial) => trial.paidAt === undefined && trial.endsAt > now);
    const paid = trials.filter((trial) => trial.paidAt !== undefined);
    const sending =
      Boolean(process.env.TOSEND_API_KEY && process.env.EMAIL_FROM) ||
      (await ctx.db.query("emailConnections").first()) !== null;
    return {
      sending,
      hasTrials: trials.length > 0,
      needsAddress: fromName() !== DEFAULT_APP_NAME && !postalAddress(),
      counts: {
        news: subscribed.length,
        accounts,
        trial_teams: onTrial.length,
        paid_teams: paid.length,
      },
    };
  },
});

/** The email exactly as it will look, for the preview beside the form. */
export const preview = query({
  args: { draft },
  returns: v.object({ subject: v.string(), html: v.string(), text: v.string() }),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const input: Draft = {
      ...args.draft,
      subject: args.draft.subject.trim() || "Your subject",
      body: args.draft.body.trim() || "What you write shows here.",
    };
    const email = withUnsubscribe(compose(input, fromName()), "https://example.com/unsubscribe");
    return { subject: email.subject, html: email.html, text: email.text };
  },
});

/** Sends the email to me only, with "[Test]" before the subject. */
export const sendTest = action({
  args: { draft },
  returns: v.union(
    v.object({ ok: v.literal(true), to: v.string() }),
    v.object({ ok: v.literal(false), detail: v.string() }),
  ),
  handler: async (ctx, args) => {
    const caller = await getCaller(ctx);
    if (!callerIsOperator(caller)) {
      throw new ConvexError({ code: "forbidden", message: "Only the operator can do this." });
    }
    const input = checkDraft(args.draft);
    const sending = await loadSending(ctx);
    if (!sending) return { ok: false as const, detail: "Email isn't set up yet." };
    const email = withUnsubscribe(
      compose(input, sending.fromName),
      newsUrl("unsubscribe", await newsToken({ purpose: "unsubscribe", email: caller!.email })),
    );
    const result = await sendEmail(
      sending.apiKey,
      { email: sending.fromEmail, name: sending.fromName },
      { to: caller!.email, ...email, subject: `[Test] ${email.subject}` },
      { timeoutMs: 20_000, baseUrl: apiBase() },
    );
    return result.ok
      ? { ok: true as const, to: caller!.email }
      : { ok: false as const, detail: failureText(result.reason, result.detail) };
  },
});

/** Sends the email now, or books it for `sendAt`. */
export const create = mutation({
  args: { draft, sendAt: v.optional(v.number()) },
  returns: v.id("broadcasts"),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const input = checkDraft(args.draft);
    const now = Date.now();
    if (args.sendAt !== undefined && args.sendAt < now - 60_000) {
      throw new ConvexError({ code: "invalid", message: "Pick a time that hasn't passed." });
    }
    const later = args.sendAt !== undefined && args.sendAt > now + 60_000;
    const id = await ctx.db.insert("broadcasts", {
      ...input,
      status: "scheduled",
      ...(later ? { scheduledFor: args.sendAt } : {}),
      createdBy: operator.email,
      createdAt: now,
      recipients: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      bounced: 0,
      complaints: 0,
      unsubscribed: 0,
    });
    const job = later
      ? await ctx.scheduler.runAt(args.sendAt!, internal.broadcasts.begin, { broadcastId: id })
      : await ctx.scheduler.runAfter(0, internal.broadcasts.begin, { broadcastId: id });
    await ctx.db.patch(id, { scheduledJob: job });
    return id;
  },
});

/** Calls off a booked email that hasn't started. */
export const cancel = mutation({
  args: { broadcastId: v.id("broadcasts") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast || broadcast.status !== "scheduled") return false;
    if (broadcast.scheduledJob) await ctx.scheduler.cancel(broadcast.scheduledJob);
    await ctx.db.patch(args.broadcastId, { status: "cancelled", finishedAt: Date.now() });
    return true;
  },
});

// ---- The Sent Emails page ----

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db.query("broadcasts").withIndex("by_created").order("desc").take(200);
    return rows.map((row) => ({
      _id: row._id,
      subject: row.subject,
      audience: row.audience,
      status: row.status,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      ...(row.scheduledFor !== undefined ? { scheduledFor: row.scheduledFor } : {}),
      ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
      ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
      recipients: row.recipients,
      sent: row.sent,
      failed: row.failed,
      skipped: row.skipped,
      bounced: row.bounced,
      complaints: row.complaints,
      unsubscribed: row.unsubscribed,
    }));
  },
});

export const get = query({
  args: { broadcastId: v.id("broadcasts") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) return null;
    const problems = await ctx.db
      .query("broadcastDeliveries")
      .withIndex("by_broadcast", (q) =>
        q.eq("broadcastId", args.broadcastId).eq("status", "failed"),
      )
      .take(50);
    const rest = { ...broadcast };
    delete rest.scheduledJob;
    return {
      broadcast: rest,
      failures: problems.map((row) => ({ email: row.email, detail: row.detail ?? "" })),
    };
  },
});

// ---- Sending ----

/** Starts sending: marks it, then gathers who it goes to. */
export const begin = internalMutation({
  args: { broadcastId: v.id("broadcasts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast || broadcast.status !== "scheduled") return null;
    await ctx.db.patch(args.broadcastId, { status: "sending", startedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.broadcasts.gather, { broadcastId: args.broadcastId });
    return null;
  },
});

type Person = { email: string; userId?: string };

/** A page of the people who get product news. */
export const newsPage = internalQuery({
  args: { cursor: v.union(v.null(), v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("subscribers")
      .withIndex("by_status", (q) => q.eq("status", "subscribed"))
      .paginate({ cursor: args.cursor, numItems: 500 });
    return {
      people: page.page.map((row) => ({
        email: row.email,
        ...(row.userId ? { userId: row.userId } : {}),
      })),
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/** The teams on a free trial, or the paying ones. */
export const teamsFor = internalQuery({
  args: { which: v.union(v.literal("trial_teams"), v.literal("paid_teams")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const trials = await ctx.db.query("teamTrials").take(5_000);
    return trials
      .filter((trial) =>
        args.which === "paid_teams"
          ? trial.paidAt !== undefined
          : trial.paidAt === undefined && trial.endsAt > now,
      )
      .map((trial) => trial.organizationId);
  },
});

/** Gathers every recipient into delivery rows, then queues the batches. */
export const gather = internalAction({
  args: { broadcastId: v.id("broadcasts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(internal.broadcasts.row, {
      broadcastId: args.broadcastId,
    });
    if (!broadcast || broadcast.status !== "sending") return null;
    const add = async (people: Person[]) => {
      for (let start = 0; start < people.length; start += 500) {
        await ctx.runMutation(internal.broadcasts.addRecipients, {
          broadcastId: args.broadcastId,
          people: people.slice(start, start + 500),
        });
      }
    };
    if (broadcast.audience === "news") {
      let cursor: string | null = null;
      for (;;) {
        const page: { people: Person[]; isDone: boolean; cursor: string } = await ctx.runQuery(
          internal.broadcasts.newsPage,
          { cursor },
        );
        await add(page.people);
        if (page.isDone) break;
        cursor = page.cursor;
      }
    } else if (broadcast.audience === "accounts") {
      let cursor: string | null = null;
      for (;;) {
        const page: {
          page: { userId: string; email: string }[];
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(components.betterAuth.members.accountsPage, {
          paginationOpts: { cursor, numItems: 500 },
        });
        await add(page.page.map((person) => ({ email: person.email, userId: person.userId })));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    } else {
      const teams = await ctx.runQuery(internal.broadcasts.teamsFor, {
        which: broadcast.audience,
      });
      for (const organizationId of teams) {
        const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
          organizationId,
        });
        await add(team.members.map((member) => ({ email: member.email, userId: member.userId })));
      }
    }
    await ctx.runMutation(internal.broadcasts.queueBatches, { broadcastId: args.broadcastId });
    return null;
  },
});

export const row = internalQuery({
  args: { broadcastId: v.id("broadcasts") },
  handler: async (ctx, args) => await ctx.db.get(args.broadcastId),
});

/**
 * Adds people to a broadcast once each. Addresses that bounced for good or marked our
 * email as spam are skipped, and so is product news to anyone who has since stopped it.
 */
export const addRecipients = internalMutation({
  args: {
    broadcastId: v.id("broadcasts"),
    people: v.array(v.object({ email: v.string(), userId: v.optional(v.string()) })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) return null;
    let added = 0;
    let skipped = 0;
    const now = Date.now();
    // Each person is put in a batch of 100 as they are added, so queueing reads nothing.
    const before = broadcast.recipients - broadcast.skipped;
    for (const person of args.people) {
      const email = normalEmail(person.email);
      const seen = await ctx.db
        .query("broadcastDeliveries")
        .withIndex("by_broadcast_and_email", (q) =>
          q.eq("broadcastId", args.broadcastId).eq("email", email),
        )
        .first();
      if (seen) continue;
      const problem = await ctx.db
        .query("emailProblems")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      const blocked = problem && (problem.kind === "complaint" || problem.permanent);
      await ctx.db.insert("broadcastDeliveries", {
        broadcastId: args.broadcastId,
        email,
        ...(person.userId ? { userId: person.userId } : {}),
        status: blocked ? "skipped" : "queued",
        ...(blocked ? {} : { batch: Math.floor((before + added) / BATCH_LIMIT) }),
        ...(blocked
          ? {
              detail:
                problem.kind === "complaint"
                  ? "Marked an earlier email as spam"
                  : "Earlier emails bounced",
            }
          : {}),
        at: now,
      });
      if (blocked) skipped += 1;
      else added += 1;
    }
    await ctx.db.patch(args.broadcastId, {
      recipients: broadcast.recipients + added + skipped,
      skipped: broadcast.skipped + skipped,
    });
    return null;
  },
});

/** Queues one batch of up to 100 for every 100 people waiting, a few at a time. */
export const queueBatches = internalMutation({
  args: { broadcastId: v.id("broadcasts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) return null;
    const batches = Math.ceil((broadcast.recipients - broadcast.skipped) / BATCH_LIMIT);
    if (batches === 0) {
      await finish(ctx, args.broadcastId);
      return null;
    }
    for (let batch = 0; batch < batches; batch += 1) {
      await backgroundPool.enqueueAction(
        ctx,
        internal.broadcasts.sendOne,
        { broadcastId: args.broadcastId, batch },
        {
          onComplete: internal.broadcasts.batchDone,
          context: { broadcastId: args.broadcastId, batch },
        },
      );
    }
    return null;
  },
});

/** Takes a batch's rows for sending, so no row is ever sent twice. */
export const claim = internalMutation({
  args: { broadcastId: v.id("broadcasts"), batch: v.number() },
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast || broadcast.status !== "sending") return null;
    const rows = await ctx.db
      .query("broadcastDeliveries")
      .withIndex("by_broadcast", (q) =>
        q.eq("broadcastId", args.broadcastId).eq("status", "queued"),
      )
      .filter((q) => q.eq(q.field("batch"), args.batch))
      .take(BATCH_LIMIT);
    for (const row of rows) await ctx.db.patch(row._id, { status: "sending" });
    return {
      draft: {
        subject: broadcast.subject,
        body: broadcast.body,
        audience: broadcast.audience,
        ...(broadcast.heading ? { heading: broadcast.heading } : {}),
        ...(broadcast.button ? { button: broadcast.button } : {}),
      },
      rows: rows.map((row) => ({ id: row._id, email: row.email })),
    };
  },
});

/** Sends one batch through toSend's batch call. */
export const sendOne = internalAction({
  args: { broadcastId: v.id("broadcasts"), batch: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.broadcasts.claim, args);
    if (!claimed || claimed.rows.length === 0) return null;
    const sending = await loadSending(ctx);
    if (!sending) {
      await settle(
        ctx,
        claimed.rows.map((row) => ({ id: row.id, ok: false, detail: "Email isn't set up." })),
      );
      return null;
    }
    const base = compose(claimed.draft as Draft, sending.fromName);
    const messages: EmailMessage[] = [];
    for (const row of claimed.rows) {
      const token = await newsToken({
        purpose: "unsubscribe",
        email: row.email,
        broadcastId: args.broadcastId,
      });
      messages.push({ to: row.email, ...withUnsubscribe(base, newsUrl("unsubscribe", token)) });
    }
    const result = await sendBatch(
      sending.apiKey,
      { email: sending.fromEmail, name: sending.fromName },
      messages,
      { timeoutMs: 60_000, baseUrl: apiBase() },
    );
    if (!result.ok) {
      const detail = failureText(result.reason, result.detail);
      console.error(`Broadcast batch ${args.batch} was not sent: ${detail}`);
      await settle(
        ctx,
        claimed.rows.map((row) => ({ id: row.id, ok: false, detail })),
      );
      return null;
    }
    await settle(
      ctx,
      claimed.rows.map((row, index) => {
        const outcome = result.results[index];
        return outcome.ok
          ? { id: row.id, ok: true, ...(outcome.messageId ? { messageId: outcome.messageId } : {}) }
          : { id: row.id, ok: false, detail: outcome.detail };
      }),
    );
    return null;
  },
});

type Outcome = { id: Id<"broadcastDeliveries">; ok: boolean; detail?: string; messageId?: string };

async function settle(ctx: ActionCtx, outcomes: Outcome[]) {
  await ctx.runMutation(internal.broadcasts.record, { outcomes });
}

export const record = internalMutation({
  args: {
    outcomes: v.array(
      v.object({
        id: v.id("broadcastDeliveries"),
        ok: v.boolean(),
        detail: v.optional(v.string()),
        messageId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const counts = new Map<Id<"broadcasts">, { sent: number; failed: number }>();
    const now = Date.now();
    for (const outcome of args.outcomes) {
      const row = await ctx.db.get(outcome.id);
      if (!row || row.status !== "sending") continue;
      await ctx.db.patch(outcome.id, {
        status: outcome.ok ? "sent" : "failed",
        at: now,
        ...(outcome.detail ? { detail: outcome.detail.slice(0, 300) } : {}),
        ...(outcome.messageId ? { messageId: outcome.messageId } : {}),
      });
      const count = counts.get(row.broadcastId) ?? { sent: 0, failed: 0 };
      if (outcome.ok) count.sent += 1;
      else count.failed += 1;
      counts.set(row.broadcastId, count);
    }
    for (const [id, count] of counts) {
      const broadcast = await ctx.db.get(id);
      if (broadcast)
        await ctx.db.patch(id, {
          sent: broadcast.sent + count.sent,
          failed: broadcast.failed + count.failed,
        });
    }
    return null;
  },
});

/**
 * After each batch, even one whose action crashed: rows it took but never settled count
 * as failed (they may or may not have gone out, so they are not sent again), and once
 * nothing is left the broadcast is done.
 */
export const batchDone = internalMutation({
  args: vOnCompleteArgs(v.object({ broadcastId: v.id("broadcasts"), batch: v.number() })),
  returns: v.null(),
  handler: async (ctx, args) => {
    const { broadcastId, batch } = args.context;
    if (args.result.kind !== "success") {
      const stuck = await ctx.db
        .query("broadcastDeliveries")
        .withIndex("by_broadcast", (q) => q.eq("broadcastId", broadcastId).eq("status", "sending"))
        .filter((q) => q.eq(q.field("batch"), batch))
        .take(BATCH_LIMIT);
      const left = await ctx.db
        .query("broadcastDeliveries")
        .withIndex("by_broadcast", (q) => q.eq("broadcastId", broadcastId).eq("status", "queued"))
        .filter((q) => q.eq(q.field("batch"), batch))
        .take(BATCH_LIMIT);
      for (const row of [...stuck, ...left]) {
        await ctx.db.patch(row._id, { status: "failed", detail: "Sending stopped part way." });
      }
      const broadcast = await ctx.db.get(broadcastId);
      if (broadcast && stuck.length + left.length > 0)
        await ctx.db.patch(broadcastId, { failed: broadcast.failed + stuck.length + left.length });
    }
    const open = await ctx.db
      .query("broadcastDeliveries")
      .withIndex("by_broadcast", (q) => q.eq("broadcastId", broadcastId).eq("status", "queued"))
      .first();
    const busy = await ctx.db
      .query("broadcastDeliveries")
      .withIndex("by_broadcast", (q) => q.eq("broadcastId", broadcastId).eq("status", "sending"))
      .first();
    if (!open && !busy) await finish(ctx, broadcastId);
    return null;
  },
});

async function finish(ctx: MutationCtx, broadcastId: Id<"broadcasts">) {
  const broadcast = await ctx.db.get(broadcastId);
  if (!broadcast || broadcast.status !== "sending") return;
  const failedAll = broadcast.sent === 0 && broadcast.failed > 0;
  await ctx.db.patch(broadcastId, {
    status: failedAll ? "failed" : "sent",
    finishedAt: Date.now(),
    ...(failedAll ? { problem: "None of the emails went out. See why below." } : {}),
  });
}

// ---- The website sign-up's confirmation email ----

export const sendConfirmation = internalAction({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.runQuery(internal.news.pending, { email: args.email }))) return null;
    const sending = await loadSending(ctx);
    if (!sending) return null;
    const token = await newsToken({ purpose: "confirm", email: args.email, issuedAt: Date.now() });
    const email = confirmNewsEmail(
      { url: newsUrl("confirm", token) },
      { appName: sending.fromName },
    );
    const result = await sendEmail(
      sending.apiKey,
      { email: sending.fromEmail, name: sending.fromName },
      { to: args.email, ...email },
      { timeoutMs: 20_000, baseUrl: apiBase() },
    );
    if (!result.ok) console.error(`The news confirmation was not sent: ${result.detail}`);
    return null;
  },
});
