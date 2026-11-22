import {
  type CaptionLook,
  type CaptionSetup,
  type LookProposal,
  lookNameProblem,
  lookShapeOf,
  lookSummary,
  MAX_CAPTION_STYLES,
  MAX_LOOKS,
  readLookAnswer,
  shotSecondsFrom,
  tidyCaptionSetup,
} from "@ncat-dash/automation-core";
import { contactSheetRequest } from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { cutsOf } from "./broll";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { captionSetupOf } from "./lib/captions";
import { teamLooksOf } from "./lib/looks";
import { DEFAULT_PARALLEL_JOBS, enqueueJob, pump } from "./lib/queue";
import { signAgentToken } from "./reviewAgent";

/**
 * # Looks
 *
 * A team copies the look of a video it likes, once. The toolkit takes a sheet of six
 * frames from the sample and finds its camera cuts (plain FFmpeg and the toolkit's cut
 * finder); then the model looks at the sheet one time, and what it saw waits as a proposal
 * until someone names and saves it. A saved look is used by the Match A Saved Look step
 * with plain FFmpeg on every run after that: no AI, and no tokens spent per video.
 */

const AGENT_TIMEOUT_MS = 120_000;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** A saved look as the screens show it. */
function lookView(look: Doc<"teamLooks">) {
  return {
    _id: look._id,
    name: look.name,
    frame: look.frame,
    captionStyle: look.captionStyle ?? null,
    shotSeconds: look.shotSeconds ?? null,
    notes: look.notes,
    sourceName: look.sourceName,
    sheetUrl: look.sheetUrl ?? null,
    summary: lookSummary({ frame: look.frame, shotSeconds: look.shotSeconds ?? null }),
    at: look.at,
  };
}

/** The team's latest study still on show: working, waiting to be saved, or failed. */
async function openStudyOf(ctx: Pick<QueryCtx, "db">, organizationId: string) {
  const latest = await ctx.db
    .query("lookStudies")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .first();
  return latest && latest.status !== "closed" ? latest : null;
}

/** The team's saved looks, and the sample being studied, if any. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    const looks = await teamLooksOf(ctx, args.organizationId);
    const study = await openStudyOf(ctx, args.organizationId);
    const proposal = (study?.proposal ?? null) as LookProposal | null;
    return {
      canEdit: MANAGER_ROLES.includes(role),
      looks: looks.map(lookView),
      study: study
        ? {
            _id: study._id,
            uploadId: study.uploadId,
            status: study.status,
            sourceName: study.sourceName,
            sheetUrl: study.sheetUrl ?? null,
            error: study.error ?? null,
            proposal,
            summary: proposal ? lookSummary(proposal) : null,
          }
        : null,
    };
  },
});

/**
 * Starts studying one of the team's uploads: a sheet of frames and its camera cuts, then
 * one look by the model. Owners and admins only, since a saved look changes what steps do.
 */
export const study = mutation({
  args: { organizationId: v.string(), uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.organizationId !== args.organizationId || upload.status !== "ready") {
      fail("not_found", "That file is no longer in your uploads.");
    }
    return await beginStudy(ctx, upload, userId);
  },
});

/**
 * Starts studying a ready upload's look: from "Copy its look", or by itself once a video
 * pasted as a link to copy its look has come in (links.ts). Throws when it cannot start.
 */
export async function beginStudy(
  ctx: MutationCtx,
  upload: Doc<"uploads">,
  userId: string,
): Promise<Id<"lookStudies">> {
  const args = { organizationId: upload.organizationId };
  const details = upload.details;
  if (!upload.contentType.startsWith("video/") || details?.hasVideo === false) {
    fail("invalid_input", "Pick a video. A look is copied from moving pictures.");
  }
  if (!details?.duration || !details.width || !details.height) {
    fail(
      "invalid_input",
      "The toolkit has not read this video's size and length yet. Try again in a minute.",
    );
  }
  const working = await openStudyOf(ctx, args.organizationId);
  if (working?.status === "working") {
    fail("busy", "A video is already being studied. Wait for it to finish first.");
  }
  if (working) await ctx.db.patch(working._id, { status: "closed" });

  const file = `upload:${upload._id}`;
  const vertical = lookShapeOf(details.width, details.height) === "vertical";
  const sheet = await enqueueJob(ctx, {
    organizationId: args.organizationId,
    stepId: "ffmpeg-compose",
    input: contactSheetRequest(file, details.duration, vertical),
    createdBy: userId,
  });
  if (!sheet.ok) fail(sheet.code, sheet.message);
  // The cuts give the look its pace. A toolkit without the cut finder still gets a look,
  // only without a pace.
  const cuts = await enqueueJob(ctx, {
    organizationId: args.organizationId,
    stepId: "media-look",
    input: { media_url: file, cuts: true, frames: false },
    createdBy: userId,
  });
  const studyId = await ctx.db.insert("lookStudies", {
    organizationId: args.organizationId,
    uploadId: upload._id,
    sourceName: upload.fileName,
    status: "working",
    sheetJobId: sheet.jobId,
    ...(cuts.ok ? { cutsJobId: cuts.jobId } : {}),
    width: details.width,
    height: details.height,
    duration: details.duration,
    createdBy: userId,
    at: Date.now(),
  });
  await ctx.db.patch(sheet.jobId, { lookStudyId: studyId });
  if (cuts.ok) await ctx.db.patch(cuts.jobId, { lookStudyId: studyId });
  await pump(ctx, args.organizationId);
  return studyId;
}

/**
 * Called whenever a job finishes. Once both of a study's jobs are done, the model is asked
 * to look at the sheet; a sheet that could not be made ends the study.
 */
export async function onLookJobFinished(ctx: MutationCtx, job: Doc<"jobs">): Promise<void> {
  if (!job.lookStudyId) return;
  const studied = await ctx.db.get(job.lookStudyId);
  if (!studied || studied.status !== "working") return;
  const [sheet, cuts] = await Promise.all([
    ctx.db.get(studied.sheetJobId),
    studied.cutsJobId ? ctx.db.get(studied.cutsJobId) : null,
  ]);
  const finished = (one: Doc<"jobs"> | null) =>
    !one || one.status === "done" || one.status === "failed";
  if (!finished(sheet) || !finished(cuts)) return;
  const sheetUrl = sheet?.status === "done" ? sheet.outputs[0] : undefined;
  if (!sheetUrl) {
    await ctx.db.patch(studied._id, {
      status: "failed",
      error: `The toolkit could not take frames from the video: ${sheet?.error ?? "it gave no picture back"}.`,
    });
    return;
  }
  const shotSeconds =
    cuts?.status === "done" ? shotSecondsFrom(cutsOf(cuts.result), studied.duration) : null;
  await ctx.db.patch(studied._id, {
    sheetUrl,
    ...(shotSeconds ? { shotSeconds } : {}),
  });
  await ctx.scheduler.runAfter(0, internal.looks.ask, { studyId: studied._id });
}

export const loadStudy = internalQuery({
  args: { studyId: v.id("lookStudies") },
  handler: async (ctx, args) => await ctx.db.get(args.studyId),
});

/** Asks the model, once, what the sample looks like, and keeps its answer as a proposal. */
export const ask = internalAction({
  args: { studyId: v.id("lookStudies") },
  handler: async (ctx, args) => {
    const studied = await ctx.runQuery(internal.looks.loadStudy, args);
    if (!studied || studied.status !== "working" || !studied.sheetUrl) return;
    const facts = {
      width: studied.width,
      height: studied.height,
      duration: studied.duration,
      shotSeconds: studied.shotSeconds ?? null,
    };
    const url = process.env.AGENT_URL;
    const secret = process.env.MASTRA_JWT_SECRET;
    let problem: string | null = null;
    let proposal: LookProposal | null = null;
    if (!url || !secret) {
      problem =
        "The agent is not set up on this dashboard yet, and it is what studies the look. Whoever runs the dashboard sets AGENT_URL and MASTRA_JWT_SECRET for Convex.";
    } else {
      try {
        const response = await fetch(new URL("/ncat/look", url), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await signAgentToken(secret, studied.createdBy)}`,
          },
          body: JSON.stringify({
            sheet: studied.sheetUrl,
            name: studied.sourceName,
            ...facts,
            organizationId: studied.organizationId,
          }),
          signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
        });
        const answer = (await response.json().catch(() => null)) as { answer?: unknown } | null;
        if (response.ok && typeof answer?.answer === "string") {
          proposal = readLookAnswer(answer.answer, facts);
        }
        if (!proposal) problem = "The agent's answer could not be read. Study the video again.";
      } catch {
        problem = "The agent could not be reached. Study the video again in a moment.";
      }
    }
    await ctx.runMutation(internal.looks.propose, {
      studyId: args.studyId,
      ...(proposal ? { proposal } : { error: problem ?? "The look could not be copied." }),
    });
  },
});

export const propose = internalMutation({
  args: {
    studyId: v.id("lookStudies"),
    proposal: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const studied = await ctx.db.get(args.studyId);
    if (!studied || studied.status !== "working") return;
    await ctx.db.patch(studied._id, {
      status: args.proposal ? "ready" : "failed",
      ...(args.proposal ? { proposal: args.proposal } : { error: args.error }),
    });
  },
});

/** Puts away the study on show without saving it. */
export const dismiss = mutation({
  args: { organizationId: v.string(), studyId: v.id("lookStudies") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const studied = await ctx.db.get(args.studyId);
    if (!studied || studied.organizationId !== args.organizationId) return;
    await ctx.db.patch(studied._id, { status: "closed" });
  },
});

/**
 * Saves a study as a named look. Its captions become a caption style of the same name,
 * with the team's others, and can be made the style for videos of its shape.
 */
export const save = mutation({
  args: {
    organizationId: v.string(),
    studyId: v.id("lookStudies"),
    name: v.string(),
    captionsForShape: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"teamLooks">> => {
    const { userId } = await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const studied = await ctx.db.get(args.studyId);
    if (!studied || studied.organizationId !== args.organizationId || studied.status !== "ready") {
      fail("not_found", "This study is no longer waiting to be saved.");
    }
    const proposal = studied.proposal as LookProposal;
    const looks = await teamLooksOf(ctx, args.organizationId);
    if (looks.length >= MAX_LOOKS) {
      fail("invalid_input", `A team keeps up to ${MAX_LOOKS} looks. Remove one first.`);
    }
    const name = args.name.trim();
    const problem = lookNameProblem(
      name,
      looks.map((one) => one.name),
    );
    if (problem) fail("invalid_input", problem);

    if (proposal.captions) {
      await addCaptionStyle(ctx, args.organizationId, name, proposal.captions, {
        forShape: args.captionsForShape ? proposal.frame.shape : null,
      });
    }
    const lookId = await ctx.db.insert("teamLooks", {
      organizationId: args.organizationId,
      name,
      frame: proposal.frame,
      ...(proposal.captions ? { captionStyle: name } : {}),
      ...(proposal.shotSeconds ? { shotSeconds: proposal.shotSeconds } : {}),
      notes: proposal.notes,
      sourceName: studied.sourceName,
      ...(studied.sheetUrl ? { sheetUrl: studied.sheetUrl } : {}),
      createdBy: userId,
      at: Date.now(),
    });
    await ctx.db.patch(studied._id, { status: "closed" });
    return lookId;
  },
});

async function addCaptionStyle(
  ctx: MutationCtx,
  organizationId: string,
  name: string,
  look: CaptionLook,
  options: { forShape: "vertical" | "wide" | "square" | null },
) {
  const setup: CaptionSetup = await captionSetupOf(ctx, organizationId);
  if (setup.styles.some((style) => style.name.toLowerCase() === name.toLowerCase())) {
    fail(
      "invalid_input",
      `There is already a caption style called "${name}". Pick another name for the look.`,
    );
  }
  if (setup.styles.length >= MAX_CAPTION_STYLES) {
    fail(
      "invalid_input",
      `A team keeps up to ${MAX_CAPTION_STYLES} caption styles, and this look's captions would be one more. Remove one in Settings → Captions first.`,
    );
  }
  const tidied = tidyCaptionSetup({
    ...setup,
    styles: [...setup.styles, { name, look }],
    byShape: options.forShape ? { ...setup.byShape, [options.forShape]: name } : setup.byShape,
  });
  if (!tidied.ok) fail("invalid_input", tidied.message);
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  if (settings) await ctx.db.patch(settings._id, { captions: tidied.setup });
  else {
    await ctx.db.insert("teamSettings", {
      organizationId,
      maxParallelJobs: DEFAULT_PARALLEL_JOBS,
      captions: tidied.setup,
    });
  }
}

/** Removes a saved look. Its caption style stays, with the team's other caption styles. */
export const remove = mutation({
  args: { organizationId: v.string(), lookId: v.id("teamLooks") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const look = await ctx.db.get(args.lookId);
    if (!look || look.organizationId !== args.organizationId) return;
    await ctx.db.delete(look._id);
  },
});
