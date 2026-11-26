import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Product news consent: who asked for it, from where, and the record of each change.
// The rules this follows: nobody gets product news without agreeing first (EU and
// Canadian law); a box at sign-up starts unticked; a website sign-up confirms by email
// before anything is sent (double opt-in); stopping is one click and takes effect at once
// (CAN-SPAM gives 10 business days; we do it straight away). Every change is kept as a
// consent record with the words the person agreed to.

export type NewsSource = Doc<"subscribers">["source"];

/** The words beside the box at sign-up and in Settings. Kept with every consent record. */
export const SIGN_UP_WORDING = "Send me product news and tips by email. I can stop any time.";
export const SETTINGS_WORDING = "Product news: new features and tips, a few times a month at most.";
export const WEBSITE_WORDING =
  "Get Takewon product news by email. We'll ask you to confirm first, and you can stop any time.";

export function normalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function subscriberOf(ctx: QueryCtx | MutationCtx, email: string) {
  return await ctx.db
    .query("subscribers")
    .withIndex("by_email", (q) => q.eq("email", normalEmail(email)))
    .first();
}

type Change = {
  email: string;
  userId?: string;
  name?: string;
  source: NewsSource;
  wording?: string;
  networkKey?: string;
  userAgent?: string;
  broadcastId?: Id<"broadcasts">;
};

async function record(
  ctx: MutationCtx,
  action: Doc<"consentRecords">["action"],
  change: Change,
  at: number,
) {
  await ctx.db.insert("consentRecords", {
    email: normalEmail(change.email),
    action,
    source: change.source,
    at,
    ...(change.userId ? { userId: change.userId } : {}),
    ...(change.wording ? { wording: change.wording } : {}),
    ...(change.networkKey ? { networkKey: change.networkKey } : {}),
    ...(change.userAgent ? { userAgent: change.userAgent.slice(0, 300) } : {}),
    ...(change.broadcastId ? { broadcastId: change.broadcastId } : {}),
  });
}

/** Someone agreed to product news (a ticked box, a switch, a confirmed website sign-up). */
export async function giveConsent(ctx: MutationCtx, change: Change): Promise<Doc<"subscribers">> {
  const now = Date.now();
  const email = normalEmail(change.email);
  const existing = await subscriberOf(ctx, email);
  await record(ctx, "given", change, now);
  const fields = {
    status: "subscribed" as const,
    source: change.source,
    subscribedAt: now,
    updatedAt: now,
    ...(change.userId ? { userId: change.userId } : {}),
    ...(change.name ? { name: change.name } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, { ...fields, unsubscribedAt: undefined });
    return (await ctx.db.get(existing._id))!;
  }
  const id = await ctx.db.insert("subscribers", { email, ...fields });
  return (await ctx.db.get(id))!;
}

/**
 * A website sign-up that has not confirmed yet. Returns false when the address already
 * gets product news, so no confirmation email is needed.
 */
export async function requestConsent(ctx: MutationCtx, change: Change): Promise<boolean> {
  const now = Date.now();
  const email = normalEmail(change.email);
  const existing = await subscriberOf(ctx, email);
  if (existing?.status === "subscribed") return false;
  await record(ctx, "requested", change, now);
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "pending",
      source: change.source,
      confirmSentAt: now,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("subscribers", {
      email,
      status: "pending",
      source: change.source,
      confirmSentAt: now,
      updatedAt: now,
    });
  }
  return true;
}

/** Someone stopped product news. Returns whether anything changed. */
export async function withdrawConsent(ctx: MutationCtx, change: Change): Promise<boolean> {
  const existing = await subscriberOf(ctx, change.email);
  if (!existing || existing.status === "unsubscribed") return false;
  const now = Date.now();
  await record(ctx, "withdrawn", change, now);
  await ctx.db.patch(existing._id, { status: "unsubscribed", unsubscribedAt: now, updatedAt: now });
  return true;
}

/** Whether this person gets product news, found by their account or their address. */
export async function newsFor(
  ctx: QueryCtx | MutationCtx,
  person: { userId: string; email: string },
): Promise<Doc<"subscribers"> | null> {
  const byUser = await ctx.db
    .query("subscribers")
    .withIndex("by_user", (q) => q.eq("userId", person.userId))
    .first();
  return byUser ?? (await subscriberOf(ctx, person.email));
}

/** With an account's deletion: their subscription and its records go too. */
export async function forgetNews(ctx: MutationCtx, person: { userId: string; email?: string }) {
  const rows = await ctx.db
    .query("subscribers")
    .withIndex("by_user", (q) => q.eq("userId", person.userId))
    .take(10);
  const emails = new Set(rows.map((row) => row.email));
  if (person.email) emails.add(normalEmail(person.email));
  for (const email of emails) {
    const subscriber = await subscriberOf(ctx, email);
    if (subscriber) await ctx.db.delete(subscriber._id);
    const records = await ctx.db
      .query("consentRecords")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(500);
    for (const row of records) await ctx.db.delete(row._id);
  }
}

/**
 * toSend reported a bounce or spam complaint (email.recordProblem): counts it against the
 * last broadcast sent to that address in the past two weeks, and a complaint stops their
 * product news, as Gmail and Yahoo expect.
 */
export async function noteProblem(ctx: MutationCtx, email: string, kind: "bounced" | "complaint") {
  const address = normalEmail(email);
  const latest = await ctx.db
    .query("broadcastDeliveries")
    .withIndex("by_email", (q) =>
      q.eq("email", address).gt("at", Date.now() - 14 * 24 * 60 * 60 * 1000),
    )
    .order("desc")
    .first();
  if (kind === "complaint") await withdrawConsent(ctx, { email: address, source: "complaint" });
  if (latest && latest.status === "sent" && !latest.problem) {
    await ctx.db.patch(latest._id, { problem: kind });
    const broadcast = await ctx.db.get(latest.broadcastId);
    if (broadcast) {
      await ctx.db.patch(
        latest.broadcastId,
        kind === "bounced"
          ? { bounced: broadcast.bounced + 1 }
          : { complaints: broadcast.complaints + 1 },
      );
    }
  }
}
