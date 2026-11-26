import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, internalMutation, internalQuery } from "./_generated/server";
import { preferenceOf, wants } from "./lib/notifications";
import { enqueueJob, pump } from "./lib/queue";

// The emails that follow a free trial between the welcome and the reminders that it ends
// (trial.ts): each one gives a single next step toward a first finished clip, and is only
// sent when the owner has not taken that step yet. Booked when the trial starts; the
// "clips ready" one when the team's first run with files finishes (alerts.runFinished).
// Each goes once, to the team's owner, and stops when they switch "Tips during my free
// trial" off in Settings > Notifications or press Unsubscribe.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const tip = v.union(
  v.literal("first_upload"),
  v.literal("clips_ready"),
  v.literal("every_upload"),
  v.literal("come_back"),
  v.literal("come_back_later"),
  v.literal("thanks"),
);

export type Tip =
  "first_upload" | "clips_ready" | "every_upload" | "come_back" | "come_back_later" | "thanks";

/** When each booked tip goes, from the trial's start and end. */
export function tipTimes(startedAt: number, endsAt: number): { tip: Tip; at: number }[] {
  const times: { tip: Tip; at: number }[] = [];
  if (startedAt + 3 * HOUR < endsAt) times.push({ tip: "first_upload", at: startedAt + 3 * HOUR });
  // Not when it would land beside the "ends tomorrow" reminder.
  if (startedAt + DAY < endsAt - DAY) times.push({ tip: "every_upload", at: startedAt + DAY });
  times.push({ tip: "come_back", at: endsAt + 4 * DAY });
  times.push({ tip: "come_back_later", at: endsAt + 11 * DAY });
  return times;
}

/** Books a fresh trial's tips. Called from trial.begin. */
export async function bookTips(
  ctx: MutationCtx,
  organizationId: string,
  startedAt: number,
  endsAt: number,
) {
  for (const { tip: which, at } of tipTimes(startedAt, endsAt)) {
    await ctx.scheduler.runAt(at, internal.email.sendTrialTip, { organizationId, tip: which });
  }
}

/**
 * The FFmpeg request for one clip's moving preview: its first three seconds as a looping
 * GIF, 240 pixels wide at 8 frames a second with a 64-colour palette, which comes to a
 * few hundred KB, light enough for an inbox (shown at 150 pixels, so sharp on a phone).
 */
export function previewRequest(videoUrl: string): Record<string, unknown> {
  return {
    inputs: [{ file_url: videoUrl }],
    filters: [
      {
        filter:
          "[0:v]trim=duration=3,fps=8,scale=240:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[palette];[b][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[v]",
      },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[v]" },
          { option: "-loop", argument: 0 },
          { option: "-f", argument: "gif" },
        ],
      },
    ],
  };
}
/** Clips shown at most. */
const PREVIEWS_AT_MOST = 3;
/** How long the tip waits for its previews before going with whatever is ready. */
export const PREVIEW_WAIT_MS = 10 * 60 * 1000;

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i;

/**
 * Books the "clips ready" tip when a team on a free trial has its first run with files.
 * Called from alerts.runFinished; cheap when the team has no trial or already heard.
 *
 * With clips among the files, the toolkit first makes a short moving preview of each (a
 * GIF, whose first frame is also what a mail app that does not play them shows), so the
 * email shows the person their own clips. It goes once they are made, or after
 * PREVIEW_WAIT_MS with what is ready; without a toolkit it goes at once, without them.
 */
export async function clipsReady(
  ctx: MutationCtx,
  organizationId: string,
  runId: Id<"runs">,
  files: string[] = [],
) {
  const trial = await ctx.db
    .query("teamTrials")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!trial || trial.paidAt !== undefined || trial.repeatOf !== undefined) return;
  if (Date.now() >= trial.endsAt) return;
  const sent = await ctx.db
    .query("trialTipsSent")
    .withIndex("by_organization_and_tip", (q) =>
      q.eq("organizationId", organizationId).eq("tip", "clips_ready"),
    )
    .first();
  if (sent) return;
  // A second run finishing while the first one's previews are being made.
  const making = await ctx.db
    .query("tipPreviews")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  if (making) return;
  const clips = files.filter((file) => VIDEO.test(file)).slice(0, PREVIEWS_AT_MOST);
  const jobIds: Id<"jobs">[] = [];
  if (trial.ownerId) {
    for (const clip of clips) {
      const queued = await enqueueJob(ctx, {
        organizationId,
        stepId: "ffmpeg-compose",
        input: previewRequest(clip),
        createdBy: trial.ownerId,
      });
      if (queued.ok) jobIds.push(queued.jobId);
    }
  }
  if (jobIds.length === 0) {
    await ctx.scheduler.runAfter(0, internal.email.sendTrialTip, {
      organizationId,
      tip: "clips_ready",
      runId,
    });
    return;
  }
  const previewId = await ctx.db.insert("tipPreviews", {
    organizationId,
    runId,
    jobIds,
    status: "waiting",
  });
  for (const jobId of jobIds) await ctx.db.patch(jobId, { tipPreviewId: previewId });
  await pump(ctx, organizationId);
  await ctx.scheduler.runAfter(PREVIEW_WAIT_MS, internal.trialTips.previewsDue, { previewId });
}

/** Sends the "clips ready" tip with the previews made so far, once. */
async function sendWithPreviews(ctx: MutationCtx, previewId: Id<"tipPreviews">) {
  const waiting = await ctx.db.get(previewId);
  if (!waiting || waiting.status !== "waiting") return;
  const previews: string[] = [];
  for (const jobId of waiting.jobIds) {
    const job = await ctx.db.get(jobId);
    const gif = job?.status === "done" ? job.outputs[0] : undefined;
    if (gif) previews.push(gif);
  }
  await ctx.db.patch(previewId, { status: "sent" });
  await ctx.scheduler.runAfter(0, internal.email.sendTrialTip, {
    organizationId: waiting.organizationId,
    tip: "clips_ready",
    runId: waiting.runId,
    previews,
  });
}

/** Called whenever a job finishes: the tip goes once all its previews are finished. */
export async function onTipPreviewJob(ctx: MutationCtx, job: Doc<"jobs">): Promise<void> {
  if (!job.tipPreviewId) return;
  const waiting = await ctx.db.get(job.tipPreviewId);
  if (!waiting || waiting.status !== "waiting") return;
  for (const jobId of waiting.jobIds) {
    const one = jobId === job._id ? job : await ctx.db.get(jobId);
    if (one && one.status !== "done" && one.status !== "failed") return;
  }
  await sendWithPreviews(ctx, waiting._id);
}

/** The previews took too long: the tip goes with what is ready. */
export const previewsDue = internalMutation({
  args: { previewId: v.id("tipPreviews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sendWithPreviews(ctx, args.previewId);
    return null;
  },
});

/**
 * Who a tip goes to, or null when it should not go: the team bought (except for the
 * thanks), the tip went already, its owner switched tips off, or they already did what
 * it suggests.
 */
export const tipFor = internalQuery({
  args: { organizationId: v.string(), tip },
  returns: v.union(
    v.null(),
    v.object({ userId: v.string(), email: v.string(), name: v.string(), teamName: v.string() }),
  ),
  handler: async (ctx, args) => {
    const trial = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!trial?.ownerId || trial.repeatOf !== undefined) return null;
    const paid = trial.paidAt !== undefined;
    if (args.tip === "thanks" ? !paid : paid) return null;
    const sent = await ctx.db
      .query("trialTipsSent")
      .withIndex("by_organization_and_tip", (q) =>
        q.eq("organizationId", args.organizationId).eq("tip", args.tip),
      )
      .first();
    if (sent) return null;
    const now = Date.now();
    const running = now < trial.endsAt;

    if (args.tip !== "thanks") {
      const preference = await preferenceOf(ctx, args.organizationId, trial.ownerId);
      if (!wants(preference, "trial_tips", "email")) return null;
    }
    if (args.tip === "first_upload" || args.tip === "every_upload") {
      if (!running) return null;
      const uploads = await ctx.db
        .query("uploads")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .take(50);
      const uploaded = uploads.some((upload) => upload.purpose !== "brand");
      if (args.tip === "first_upload" && uploaded) return null;
      if (args.tip === "every_upload") {
        if (!uploaded) return null;
        const automations = await ctx.db
          .query("automations")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
          .take(100);
        if (automations.some((automation) => automation.enabled)) return null;
      }
    }
    if (args.tip === "clips_ready" && !running) return null;
    if ((args.tip === "come_back" || args.tip === "come_back_later") && running) return null;

    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: args.organizationId,
    });
    const owner = team.members.find((member) => member.userId === trial.ownerId);
    if (!owner || !team.teamName) return null;
    return { userId: owner.userId, email: owner.email, name: owner.name, teamName: team.teamName };
  },
});

/** Notes that a tip went, so it never goes twice. */
export const recordSent = internalMutation({
  args: { organizationId: v.string(), tip },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("trialTipsSent", { ...args, sentAt: Date.now() });
    return null;
  },
});
