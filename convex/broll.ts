import {
  type AutomationEdge,
  type AutomationNode,
  type BrollMoment,
  brollMomentsFromWords,
  brollRequest,
  brollSettings,
  chooseCutaways,
  type Cutaway,
  cutawaySummary,
  type Footage,
  nearestUpstreamOfKind,
  pexelsHits,
  pexelsSearchUrl,
  pixabayHits,
  pixabaySearchUrl,
  readFileDetails,
  scoreOf,
  sourceKey,
  STOCK_CACHE_MS,
  STOCK_SITE_NAMES,
  type StockHit,
  type StockSite,
  stockQuery,
  usesLibrary,
  usesStock,
} from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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
import { bucketOf, presign } from "./lib/bucket";
import { refreshBrollLike, usableAsBroll } from "./lib/broll";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { heardFrom, MAX_VIDEOS_PER_PICK_STEP, wordsFor } from "./lib/moments";
import { enqueueAll, advance, failStep } from "./lib/runner";
import { enqueueJob, pump } from "./lib/queue";
import { PickError, wordsOfVideo } from "./moments";

/**
 * B-Roll (automation-core broll.ts has the rules).
 *
 * The library side: every new video in the Content Library is looked at by the picture
 * model (CLIP, the toolkit's /v1/media/look) when the team keeps new files searchable,
 * so it can be found by what it shows. Short ones with small faces and little said are
 * marked as B-Roll; a person can say otherwise on the file.
 *
 * The run side, for an Add B-Roll step after "listen" (convex/lib/moments.ts):
 * - "match": the moments to cover come from Plan B-Roll's plan, or else every sentence
 *   that names something to show. Free stock is searched for the strongest of them.
 * - "look": one toolkit job turns the words and the stock stills into vectors.
 * - choose (here): the library is searched with each moment's vector, stock is scored by
 *   its still, the cutaways are chosen, and one compose job per video lays them over
 *   ("lay", which the runner finishes like any job).
 */

// Signed links the toolkit reads files through: long enough to wait in the queue.
const READ_LINK_SECONDS = 7 * 24 * 60 * 60;
// Moments of one video looked at, at most; a long talk is sampled evenly.
const MAX_MOMENTS_PER_VIDEO = 80;
// Moments of one video searched on stock, at most.
const MAX_STOCK_SEARCHES = 12;
// Stills sent to the picture model in one job (the toolkit takes 60).
const MAX_STILLS = 40;
/** Stock videos kept per moment, so 12 searched moments give at most 36 stills. */
const STOCK_PER_MOMENT = 3;
/**
 * At most this many phrases go to the picture model in one run. Its answer (one vector of
 * 512 numbers per phrase and per still) is kept on the job, which must stay well under a
 * document's size limit: 120 vectors is about half a megabyte.
 */
const MAX_LOOK_TEXTS = 80;
// Library frames each moment's search looks at.
const FRAMES_PER_SEARCH = 24;
const MAX_LOOK_AT_ONCE = 200;

// What the picture model reads for a moment: CLIP's own way of naming a picture.
export const lookWords = (show: string) => `a photo of ${show}`;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

// --------------------------------------------------------------------------------------
// The library: looking at files

/** Looks at a new library video with the picture model. */
export const lookAt = internalAction({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(internal.library.loadInternal, args);
    if (!item || item.kind !== "video") return;
    const url = await readLink(ctx, item);
    if (!url) return;
    await ctx.runMutation(internal.broll.startLook, { itemId: item._id, mediaUrl: url });
  },
});

async function readLink(ctx: ActionCtx, item: Doc<"libraryItems">): Promise<string | null> {
  if (!item.key) return item.url ?? null;
  const connection = await ctx.runQuery(internal.storage.load, {
    organizationId: item.organizationId,
  });
  if (!connection) return null;
  try {
    return await presign(await bucketOf(connection), "GET", item.key, READ_LINK_SECONDS);
  } catch {
    return null;
  }
}

/** Queues the picture model's look at one file. False when there is nothing to do. */
export const startLook = internalMutation({
  args: { itemId: v.id("libraryItems"), mediaUrl: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    // Looked at once: a file does not change, so a second look would find the same.
    if (!item || item.kind !== "video" || item.look?.status === "working") return false;
    if (item.look?.status === "ready") return false;
    const queued = await enqueueJob(ctx, {
      organizationId: item.organizationId,
      stepId: "media-look",
      input: { media_url: args.mediaUrl },
      createdBy: item.createdBy ?? "library",
    });
    if (!queued.ok) {
      await ctx.db.patch(item._id, {
        look: { status: "failed", error: queued.message, at: Date.now() },
      });
      return false;
    }
    await ctx.db.patch(queued.jobId, { libraryItemId: item._id });
    await ctx.db.patch(item._id, {
      look: { status: "working", jobId: queued.jobId, at: Date.now() },
    });
    await pump(ctx, item.organizationId);
    return true;
  },
});

interface LookedFrame {
  time: number;
  face: number;
  vector: number[];
}

function framesOf(result: unknown): { duration: number; frames: LookedFrame[] } | null {
  const media = (result as { media?: unknown } | null)?.media as
    { duration?: unknown; frames?: unknown } | undefined;
  if (!media || !Array.isArray(media.frames)) return null;
  const frames: LookedFrame[] = [];
  for (const raw of media.frames) {
    const frame = raw as { time?: unknown; face?: unknown; vector?: unknown };
    if (
      typeof frame.time !== "number" ||
      !Array.isArray(frame.vector) ||
      frame.vector.length !== 512 ||
      !frame.vector.every((x) => typeof x === "number")
    ) {
      continue;
    }
    frames.push({
      time: frame.time,
      face: typeof frame.face === "number" ? frame.face : 0,
      vector: frame.vector as number[],
    });
  }
  return { duration: typeof media.duration === "number" ? media.duration : 0, frames };
}

/** Keeps what the picture model saw in a library file. Called when its job finishes. */
export const saveLook = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.libraryItemId) return;
    const item = await ctx.db.get(job.libraryItemId);
    // A newer look has started since; its answer is the one that counts.
    if (!item || item.look?.jobId !== job._id) return;
    const seen = job.status === "done" ? framesOf(job.result) : null;
    if (!seen || seen.frames.length === 0) {
      await ctx.db.patch(item._id, {
        look: {
          status: "failed",
          jobId: job._id,
          error: job.error ?? "The picture model's answer could not be read.",
          at: Date.now(),
        },
      });
      return;
    }
    for (const old of await ctx.db
      .query("libraryFrames")
      .withIndex("by_item", (q) => q.eq("itemId", item._id))
      .take(500)) {
      await ctx.db.delete(old._id);
    }
    for (const frame of seen.frames) {
      await ctx.db.insert("libraryFrames", {
        organizationId: item.organizationId,
        itemId: item._id,
        ...frame,
      });
    }
    await ctx.db.patch(item._id, {
      look: { status: "ready", jobId: job._id, at: Date.now() },
    });
    await refreshBrollLike(ctx, item._id);
  },
});

/** Says whether a library file is B-Roll: "yes", "no", or "auto" to go by how it looks. */
export const setUse = mutation({
  args: {
    organizationId: v.string(),
    itemId: v.id("libraryItems"),
    use: v.union(v.literal("yes"), v.literal("no"), v.literal("auto")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.organizationId !== args.organizationId) fail("not_found", "File not found.");
    if (item.kind !== "video") fail("invalid_input", "Only videos can be used as B-Roll.");
    await ctx.db.patch(item._id, { broll: args.use === "auto" ? undefined : args.use });
  },
});

/**
 * Works out again, for every library video already looked at, whether it looks like
 * B-Roll: for when the rules change (`npx convex run broll:judgeAgain`). A few files at a
 * time, each read with its frames and words, then the next page is scheduled.
 */
export const judgeAgain = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ judged: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("libraryItems")
      .paginate({ cursor: args.cursor ?? null, numItems: 20 });
    let judged = 0;
    for (const item of page.page) {
      if (item.kind !== "video" || item.look?.status !== "ready") continue;
      await refreshBrollLike(ctx, item._id);
      judged++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.broll.judgeAgain, { cursor: page.continueCursor });
    }
    return { judged, done: page.isDone };
  },
});

export const lookTargets = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(2000);
    return items
      .filter((item) => item.kind === "video" && (!item.look || item.look.status === "failed"))
      .slice(0, MAX_LOOK_AT_ONCE);
  },
});

/** Has the picture model look at the library's videos it has not seen yet. Managers. */
export const lookThroughLibrary = action({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const items: Doc<"libraryItems">[] = await ctx.runQuery(internal.broll.lookTargets, args);
    let sent = 0;
    for (const item of items) {
      const url = await readLink(ctx, item);
      if (!url) continue;
      if (await ctx.runMutation(internal.broll.startLook, { itemId: item._id, mediaUrl: url })) {
        sent++;
      }
    }
    return sent;
  },
});

// --------------------------------------------------------------------------------------
// Stock keys

type KeyState = "built-in" | "team" | "none";

function builtInKey(site: StockSite): string | undefined {
  const value = site === "pixabay" ? process.env.PIXABAY_API_KEY : process.env.PEXELS_API_KEY;
  return value && value.trim() ? value.trim() : undefined;
}

async function keysRow(ctx: QueryCtx, organizationId: string) {
  return await ctx.db
    .query("stockKeys")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
}

/** What Settings > B-Roll shows: where stock comes from and how far the library is. */
export const status = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    const row = await keysRow(ctx, args.organizationId);
    const state = (site: StockSite): KeyState =>
      builtInKey(site) ? "built-in" : row?.[site] ? "team" : "none";
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(2000);
    const videos = items.filter((item) => item.kind === "video");
    return {
      keys: { pixabay: state("pixabay"), pexels: state("pexels") },
      manager: MANAGER_ROLES.includes(role),
      videos: videos.length,
      looked: videos.filter((item) => item.look?.status === "ready").length,
      looking: videos.filter((item) => item.look?.status === "working").length,
      broll: videos.filter(usableAsBroll).length,
    };
  },
});

export const authorizeKeys = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    return null;
  },
});

export const writeKeys = internalMutation({
  args: {
    organizationId: v.string(),
    pixabay: v.optional(v.union(v.string(), v.null())),
    pexels: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const row = await keysRow(ctx, args.organizationId);
    const next = {
      organizationId: args.organizationId,
      pixabay: args.pixabay === undefined ? row?.pixabay : (args.pixabay ?? undefined),
      pexels: args.pexels === undefined ? row?.pexels : (args.pexels ?? undefined),
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.replace(row._id, next);
    else await ctx.db.insert("stockKeys", next);
  },
});

/** Checks a stock key with one search; null when it works, else what is wrong. */
async function keyProblem(site: StockSite, key: string): Promise<string | null> {
  try {
    const response =
      site === "pixabay"
        ? await fetch(pixabaySearchUrl(key, "nature", false), {
            signal: AbortSignal.timeout(15_000),
          })
        : await fetch(pexelsSearchUrl("nature", false), {
            headers: { authorization: key },
            signal: AbortSignal.timeout(15_000),
          });
    if (response.ok) return null;
    return response.status === 400 || response.status === 401 || response.status === 403
      ? `${STOCK_SITE_NAMES[site]} did not accept this key. Copy it again from your account.`
      : `${STOCK_SITE_NAMES[site]} could not be reached. Try again in a minute.`;
  } catch {
    return `${STOCK_SITE_NAMES[site]} could not be reached. Try again in a minute.`;
  }
}

/** Saves (or, with an empty key, removes) the team's own stock key. Owners and admins. */
export const saveKey = action({
  args: {
    organizationId: v.string(),
    site: v.union(v.literal("pixabay"), v.literal("pexels")),
    key: v.string(),
  },
  returns: v.object({ ok: v.boolean(), detail: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.broll.authorizeKeys, { organizationId: args.organizationId });
    const key = args.key.trim();
    if (key) {
      const problem = await keyProblem(args.site, key);
      if (problem) return { ok: false, detail: problem };
    }
    await ctx.runMutation(internal.broll.writeKeys, {
      organizationId: args.organizationId,
      [args.site]: key ? await encryptSecret(key) : null,
    });
    return { ok: true };
  },
});

export const teamKeys = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const row = await keysRow(ctx, args.organizationId);
    return { pixabay: row?.pixabay ?? null, pexels: row?.pexels ?? null };
  },
});

/** The stock keys a team's runs search with: the team's own first, then the built-in ones. */
async function stockKeysFor(
  ctx: ActionCtx,
  organizationId: string,
): Promise<Partial<Record<StockSite, string>>> {
  const saved = await ctx.runQuery(internal.broll.teamKeys, { organizationId });
  const keys: Partial<Record<StockSite, string>> = {};
  for (const site of ["pixabay", "pexels"] as const) {
    const own = saved[site];
    if (own) {
      try {
        keys[site] = await decryptSecret(own);
        continue;
      } catch {
        // Fall back to the built-in key below.
      }
    }
    const builtIn = builtInKey(site);
    if (builtIn) keys[site] = builtIn;
  }
  return keys;
}

// --------------------------------------------------------------------------------------
// Stock searches, kept a day

const hitValidator = v.object({
  id: v.string(),
  url: v.string(),
  thumbnail: v.string(),
  page: v.string(),
  by: v.string(),
  title: v.string(),
  duration: v.number(),
  width: v.number(),
  height: v.number(),
});

export const keptSearch = internalQuery({
  args: { site: v.union(v.literal("pixabay"), v.literal("pexels")), query: v.string() },
  handler: async (ctx, args) => {
    const found = await ctx.db
      .query("stockSearches")
      .withIndex("by_site_and_query", (q) => q.eq("site", args.site).eq("query", args.query))
      .first();
    return found && Date.now() - found.at < STOCK_CACHE_MS ? found.hits : null;
  },
});

export const keepSearch = internalMutation({
  args: {
    site: v.union(v.literal("pixabay"), v.literal("pexels")),
    query: v.string(),
    hits: v.array(hitValidator),
  },
  handler: async (ctx, args) => {
    const found = await ctx.db
      .query("stockSearches")
      .withIndex("by_site_and_query", (q) => q.eq("site", args.site).eq("query", args.query))
      .first();
    const row = { ...args, at: Date.now() };
    if (found) await ctx.db.replace(found._id, row);
    else await ctx.db.insert("stockSearches", row);
  },
});

async function searchStock(
  ctx: ActionCtx,
  site: StockSite,
  key: string,
  words: string,
  tall: boolean,
): Promise<StockHit[]> {
  const query = `${stockQuery(words)}${tall ? " |tall" : ""}`;
  const kept = await ctx.runQuery(internal.broll.keptSearch, { site, query });
  if (kept) return kept;
  let hits: StockHit[] = [];
  try {
    const response =
      site === "pixabay"
        ? await fetch(pixabaySearchUrl(key, words, tall), { signal: AbortSignal.timeout(15_000) })
        : await fetch(pexelsSearchUrl(words, tall), {
            headers: { authorization: key },
            signal: AbortSignal.timeout(15_000),
          });
    if (!response.ok) return [];
    const answer = await response.json();
    hits = site === "pixabay" ? pixabayHits(answer) : pexelsHits(answer);
  } catch {
    return [];
  }
  await ctx.runMutation(internal.broll.keepSearch, { site, query, hits });
  return hits;
}

// --------------------------------------------------------------------------------------
// A run: "match"

interface WorkVideo {
  url: string;
  width: number;
  height: number;
  duration: number;
  moments: BrollMoment[];
  /** The stock found for each moment, by the moment's index. */
  stock: Record<string, StockHit[]>;
}

async function stepsMap(ctx: QueryCtx, run: Doc<"runs">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  return new Map(steps.map((other) => [other.nodeId, other]));
}

async function loadStep(ctx: QueryCtx, runStepId: Id<"runSteps">, stage: "match" | "look") {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "running" || step.stage !== stage) return null;
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  if (!node || node.kind !== "broll") return null;
  return { step, run, node };
}

export const loadMatch = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await loadStep(ctx, args.runStepId, "match");
    if (!loaded) return null;
    const { step, run, node } = loaded;
    const jobs = (await Promise.all(step.jobIds.map((id) => ctx.db.get(id)))).filter(
      (job) => job !== null,
    );
    const nodes = run.nodes as AutomationNode[];
    const planNode = nearestUpstreamOfKind(
      node.id,
      "broll-plan",
      nodes,
      run.edges as AutomationEdge[],
    );
    const planStep = planNode ? (await stepsMap(ctx, run)).get(planNode.id) : undefined;
    const plan = Array.isArray(planStep?.aiPlan)
      ? (planStep.aiPlan as { source: string; cutaways: BrollMoment[] }[])
      : null;
    const videos = [];
    for (const heard of heardFrom(jobs).slice(0, MAX_VIDEOS_PER_PICK_STEP)) {
      const known = await wordsFor(ctx, run.organizationId, heard.url);
      const details = readFileDetails(heard.metadata);
      videos.push({
        url: heard.url,
        duration: heard.duration ?? known?.duration ?? 0,
        width: details?.width ?? 0,
        height: details?.height ?? 0,
        wordsFile: heard.wordsFile,
        segments: known ? null : heard.segments,
        words: known?.words ?? null,
        planned:
          plan?.find((one) => sourceKey(one.source) === sourceKey(heard.url))?.cutaways ?? null,
      });
    }
    return { organizationId: run.organizationId, input: node.input, videos, planned: !!plan };
  },
});

/** Every `step` moments apart, so a long list is sampled evenly. */
function spread<T>(items: T[], most: number): { item: T; index: number }[] {
  const all = items.map((item, index) => ({ item, index }));
  if (all.length <= most) return all;
  const step = all.length / most;
  return Array.from({ length: most }, (_, i) => all[Math.floor(i * step)]);
}

export const match = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.broll.loadMatch, args);
    if (!loaded) return;
    try {
      const settings = brollSettings(loaded.input);
      const keys = usesStock(settings) ? await stockKeysFor(ctx, loaded.organizationId) : {};
      const sites = (Object.keys(keys) as StockSite[]).filter((site) => keys[site]);
      if (settings.sources === "stock" && sites.length === 0) {
        throw new PickError(
          "Stock footage is not set up on this dashboard. Add a free Pixabay key in Settings > B-Roll, or let this step use your library.",
        );
      }
      const work: WorkVideo[] = [];
      for (const video of loaded.videos) {
        const words = await wordsOfVideo(ctx, loaded.organizationId, video);
        const duration = video.duration || words[words.length - 1].end;
        const all = video.planned ?? brollMomentsFromWords(words);
        const moments = spread(
          all.filter(
            (moment) =>
              moment.start >= settings.skipOpening - 0.5 || moment.end > settings.skipOpening,
          ),
          MAX_MOMENTS_PER_VIDEO,
        ).map(({ item }) => item);
        const stock: Record<string, StockHit[]> = {};
        if (sites.length > 0) {
          // Searched for moments spread evenly over the video, a few hits each, so the
          // stills the picture model looks at stay within what one job can answer.
          const tall = video.height > video.width;
          for (const { item: moment, index } of spread(moments, MAX_STOCK_SEARCHES)) {
            for (const site of sites) {
              const hits = await searchStock(ctx, site, keys[site]!, moment.show, tall);
              stock[index] = [...(stock[index] ?? []), ...hits].slice(0, STOCK_PER_MOMENT);
            }
          }
        }
        work.push({
          url: video.url,
          width: video.width,
          height: video.height,
          duration,
          moments,
          stock,
        });
      }
      await ctx.runMutation(internal.broll.startLooking, { runStepId: args.runStepId, work });
    } catch (error) {
      await ctx.runMutation(internal.broll.stop, {
        runStepId: args.runStepId,
        stage: "match",
        error:
          error instanceof PickError
            ? error.message
            : "Finding B-Roll failed. Run it again in a moment.",
      });
    }
  },
});

/** Fails an Add B-Roll step with a plain reason. */
export const stop = internalMutation({
  args: {
    runStepId: v.id("runSteps"),
    stage: v.union(v.literal("match"), v.literal("look")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const loaded = await loadStep(ctx, args.runStepId, args.stage);
    if (!loaded) return;
    await failStep(ctx, loaded.run, loaded.step, await stepsMap(ctx, loaded.run), args.error);
    await advance(ctx, loaded.run._id);
  },
});

/** Keeps the moments and stock found, and has the picture model look at them. */
export const startLooking = internalMutation({
  args: { runStepId: v.id("runSteps"), work: v.any() },
  handler: async (ctx, args) => {
    const loaded = await loadStep(ctx, args.runStepId, "match");
    if (!loaded) return;
    const { run, step } = loaded;
    const work = args.work as WorkVideo[];
    const texts = [
      ...new Set(work.flatMap((video) => video.moments.map((moment) => lookWords(moment.show)))),
    ].slice(0, MAX_LOOK_TEXTS);
    const stills = [
      ...new Set(
        work.flatMap((video) =>
          Object.values(video.stock).flatMap((hits) => hits.map((hit) => hit.thumbnail)),
        ),
      ),
    ].slice(0, MAX_STILLS);
    if (texts.length === 0) {
      // Nothing that was said names something to show: the videos carry on as they are.
      await ctx.db.patch(step._id, {
        status: "done",
        stage: undefined,
        cutaways: [],
        pickNote: "Nothing that was said names something to show, so no cutaways were added.",
        outputs: work.map((video) => video.url),
        finishedAt: Date.now(),
      });
      await advance(ctx, run._id);
      return;
    }
    const queued = await enqueueAll(ctx, run, step, [
      { stepId: "media-look", input: { texts, ...(stills.length ? { image_urls: stills } : {}) } },
    ]);
    if (!queued.ok) {
      await failStep(ctx, run, step, await stepsMap(ctx, run), queued.message);
      await advance(ctx, run._id);
      return;
    }
    await ctx.db.patch(step._id, { stage: "look", jobIds: queued.jobIds, brollWork: work });
    await advance(ctx, run._id);
  },
});

// --------------------------------------------------------------------------------------
// A run: choosing the cutaways

export const loadChoose = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await loadStep(ctx, args.runStepId, "look");
    if (!loaded) return null;
    const job = loaded.step.jobIds.length ? await ctx.db.get(loaded.step.jobIds[0]) : null;
    return {
      organizationId: loaded.run.organizationId,
      input: loaded.node.input,
      work: (loaded.step.brollWork ?? []) as WorkVideo[],
      result: job?.status === "done" ? job.result : null,
    };
  },
});

/** The library files behind frames the vector search found, when usable as B-Roll. */
export const framesFound = internalQuery({
  args: { frameIds: v.array(v.id("libraryFrames")) },
  handler: async (ctx, args) => {
    const found = [];
    for (const frameId of args.frameIds) {
      const frame = await ctx.db.get(frameId);
      if (!frame) continue;
      const item = await ctx.db.get(frame.itemId);
      if (!item || !usableAsBroll(item)) continue;
      found.push({
        frameId,
        time: frame.time,
        item: {
          _id: item._id,
          shortId: item.shortId,
          title: item.title,
          key: item.key ?? null,
          url: item.url ?? null,
          duration: item.details?.duration ?? 0,
          organizationId: item.organizationId,
        },
      });
    }
    return found;
  },
});

function vectorsOf(result: unknown) {
  const texts = new Map<string, number[]>();
  const stills = new Map<string, number[]>();
  const answer = (result ?? {}) as { texts?: unknown; pictures?: unknown };
  for (const raw of Array.isArray(answer.texts) ? answer.texts : []) {
    const one = raw as { text?: unknown; vector?: unknown };
    if (typeof one.text === "string" && Array.isArray(one.vector)) {
      texts.set(one.text, one.vector as number[]);
    }
  }
  for (const raw of Array.isArray(answer.pictures) ? answer.pictures : []) {
    const one = raw as { url?: unknown; vector?: unknown };
    if (typeof one.url === "string" && Array.isArray(one.vector)) {
      stills.set(one.url, one.vector as number[]);
    }
  }
  return { texts, stills };
}

export const choose = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.broll.loadChoose, args);
    if (!loaded) return;
    try {
      if (!loaded.result) throw new PickError("The picture model's answer could not be read.");
      const settings = brollSettings(loaded.input);
      const { texts, stills } = vectorsOf(loaded.result);
      const connection = await ctx.runQuery(internal.storage.load, {
        organizationId: loaded.organizationId,
      });
      const bucket = connection ? await bucketOf(connection) : null;
      const links = new Map<string, string | null>();
      const linkOf = async (item: { key: string | null; url: string | null; shortId: string }) => {
        if (!item.key) return item.url;
        if (links.has(item.shortId)) return links.get(item.shortId)!;
        let url: string | null = null;
        if (bucket) {
          try {
            url = await presign(bucket, "GET", item.key, READ_LINK_SECONDS);
          } catch {
            url = null;
          }
        }
        links.set(item.shortId, url);
        return url;
      };

      const results: { video: WorkVideo; cutaways: Cutaway[] }[] = [];
      for (const video of loaded.work) {
        const options: Footage[][] = [];
        for (const [index, moment] of video.moments.entries()) {
          const vector = texts.get(lookWords(moment.show));
          const found: Footage[] = [];
          if (vector && usesLibrary(settings)) {
            const near = await ctx.vectorSearch("libraryFrames", "by_vector", {
              vector,
              limit: FRAMES_PER_SEARCH,
              filter: (q) => q.eq("organizationId", loaded.organizationId),
            });
            const frames = await ctx.runQuery(internal.broll.framesFound, {
              frameIds: near.map((hit) => hit._id),
            });
            const score = new Map(near.map((hit) => [hit._id, hit._score]));
            const best = new Map<string, Footage>();
            for (const frame of frames) {
              // Never the video being covered, nor a copy of it.
              if (frame.item.key && sourceKey(video.url).includes(frame.item.key)) continue;
              const url = await linkOf(frame.item);
              if (!url) continue;
              const one: Footage = {
                kind: "library",
                url,
                ref: frame.item.shortId,
                title: frame.item.title,
                duration: frame.item.duration,
                bestAt: frame.time,
                score: score.get(frame.frameId) ?? 0,
              };
              const before = best.get(one.ref);
              if (!before || before.score < one.score) best.set(one.ref, one);
            }
            found.push(...best.values());
          }
          for (const hit of video.stock[String(index)] ?? []) {
            const still = stills.get(hit.thumbnail);
            if (!vector || !still) continue;
            const site = hit.id.split(":")[0] as StockSite;
            found.push({
              kind: "stock",
              url: hit.url,
              ref: hit.id,
              title: hit.title,
              duration: hit.duration,
              bestAt: hit.duration / 2,
              score: scoreOf(vector, still),
              credit: { site: STOCK_SITE_NAMES[site] ?? site, page: hit.page, by: hit.by },
            });
          }
          options.push(found);
        }
        results.push({
          video,
          cutaways: chooseCutaways(video.moments, options, settings, { duration: video.duration }),
        });
      }
      await ctx.runMutation(internal.broll.lay, { runStepId: args.runStepId, results });
    } catch (error) {
      await ctx.runMutation(internal.broll.stop, {
        runStepId: args.runStepId,
        stage: "look",
        error:
          error instanceof PickError
            ? error.message
            : "Choosing B-Roll failed. Run it again in a moment.",
      });
    }
  },
});

/** Queues the FFmpeg work that lays the chosen cutaways over each video. */
export const lay = internalMutation({
  args: { runStepId: v.id("runSteps"), results: v.any() },
  handler: async (ctx, args) => {
    const loaded = await loadStep(ctx, args.runStepId, "look");
    if (!loaded) return;
    const { run, step, node } = loaded;
    const settings = brollSettings(node.input);
    const results = args.results as { video: WorkVideo; cutaways: Cutaway[] }[];
    const all = results.flatMap((result) => result.cutaways);
    const kept = results.flatMap(({ video, cutaways }) =>
      cutaways.map((cut) => ({
        source: video.url,
        start: cut.start,
        end: cut.end,
        said: cut.said.slice(0, 500),
        show: cut.show.slice(0, 200),
        kind: cut.footage.kind,
        ref: cut.footage.ref,
        title: cut.footage.title.slice(0, 200),
        score: Math.round(cut.footage.score * 1000) / 1000,
        ...(cut.footage.credit ? { credit: cut.footage.credit } : {}),
      })),
    );
    if (all.length === 0) {
      await ctx.db.patch(step._id, {
        status: "done",
        stage: undefined,
        brollWork: undefined,
        cutaways: [],
        pickNote:
          "No footage looked enough like what was said, so no cutaways were added. Add B-Roll to your library, turn on stock footage, or set the match to loose.",
        outputs: results.map((result) => result.video.url),
        finishedAt: Date.now(),
      });
      await advance(ctx, run._id);
      return;
    }
    const wanted = results
      .filter((result) => result.cutaways.length > 0)
      .map(({ video, cutaways }) => ({
        stepId: "ffmpeg-compose",
        input: brollRequest(
          video.url,
          {
            width: video.width || 1920,
            height: video.height || 1080,
          },
          cutaways,
          settings.look,
        ),
      }));
    const queued = await enqueueAll(ctx, run, step, wanted);
    if (!queued.ok) {
      await failStep(ctx, run, step, await stepsMap(ctx, run), queued.message);
      await advance(ctx, run._id);
      return;
    }
    await ctx.db.patch(step._id, {
      stage: "lay",
      jobIds: queued.jobIds,
      // Which videos got cutaways, in order, so the ones without any are handed on as they are.
      brollWork: results.map((result) => ({
        url: result.video.url,
        laid: result.cutaways.length > 0,
      })),
      cutaways: kept,
      pickNote: cutawaySummary(all),
    });
    await advance(ctx, run._id);
  },
});
