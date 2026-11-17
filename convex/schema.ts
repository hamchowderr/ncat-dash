import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const nodeValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("step"),
    v.literal("approval"),
    v.literal("clips"),
    v.literal("export"),
    v.literal("if"),
    v.literal("wait"),
  ),
  stepId: v.optional(v.string()),
  label: v.optional(v.string()),
  input: v.record(v.string(), v.any()),
  position: v.object({ x: v.number(), y: v.number() }),
});

export const editorValidator = v.union(
  v.literal("premiere"),
  v.literal("resolve"),
  v.literal("finalcut"),
  v.literal("capcut"),
);

export const edgeValidator = v.object({
  id: v.string(),
  source: v.string(),
  target: v.string(),
  // Which way out of an If the connection leaves by: "yes" or "no".
  branch: v.optional(v.string()),
});

const fileTypeValidator = v.union(
  v.literal("any"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("image"),
);

export const triggerValidator = v.union(
  v.object({ kind: v.literal("manual") }),
  v.object({ kind: v.literal("webhook") }),
  v.object({
    kind: v.literal("schedule"),
    schedule: v.union(
      v.object({ mode: v.literal("interval"), minutes: v.number() }),
      v.object({ mode: v.literal("daily"), time: v.string(), timeZone: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal("upload"),
    fileType: fileTypeValidator,
    // Length limits in seconds, checked against the details read from the file.
    minSeconds: v.optional(v.number()),
    maxSeconds: v.optional(v.number()),
  }),
  // A folder in the team's own bucket, checked every minute for new files.
  v.object({ kind: v.literal("folder"), prefix: v.string(), fileType: fileTypeValidator }),
);

/**
 * One change to an automation, as the canvas and the agent send it. The shapes are the
 * `Operation` type in packages/automation-core/src/operations.ts.
 */
export const operationValidator = v.union(
  v.object({
    op: v.literal("add"),
    type: v.string(),
    id: v.optional(v.string()),
    after: v.optional(v.string()),
    before: v.optional(v.string()),
    branch: v.optional(v.string()),
    settings: v.optional(v.record(v.string(), v.any())),
    label: v.optional(v.string()),
  }),
  v.object({ op: v.literal("remove"), ids: v.array(v.string()) }),
  v.object({
    op: v.literal("connect"),
    source: v.string(),
    target: v.string(),
    branch: v.optional(v.string()),
  }),
  v.object({ op: v.literal("disconnect"), source: v.string(), target: v.string() }),
  v.object({ op: v.literal("set"), id: v.string(), settings: v.record(v.string(), v.any()) }),
  v.object({ op: v.literal("use"), id: v.string(), field: v.string(), from: v.string() }),
  v.object({ op: v.literal("rename"), id: v.string(), label: v.string() }),
  v.object({ op: v.literal("trigger"), trigger: triggerValidator }),
  v.object({ op: v.literal("name"), name: v.string() }),
  v.object({ op: v.literal("tidy") }),
);

/** One track in the team's music library: a name people pick it by, and where the file is. */
export const musicValidator = v.array(v.object({ name: v.string(), file: v.string() }));

/** What the toolkit read from a file. Mirrors FileDetails in automation-core. */
export const fileDetailsValidator = v.object({
  duration: v.optional(v.number()),
  filesize: v.optional(v.number()),
  format: v.optional(v.string()),
  bitrate: v.optional(v.number()),
  hasVideo: v.optional(v.boolean()),
  hasAudio: v.optional(v.boolean()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  fps: v.optional(v.number()),
  videoCodec: v.optional(v.string()),
  audioCodec: v.optional(v.string()),
  audioChannels: v.optional(v.number()),
  audioSampleRate: v.optional(v.number()),
});

export const brandValidator = v.object({
  logo: v.optional(v.string()),
  color: v.optional(v.string()),
  font: v.optional(v.string()),
  music: v.optional(v.string()),
});

// Users, sessions, organizations (teams), members and invitations live in the
// Better Auth component (convex/betterAuth). App tables point at a team by its
// organization id, and every read or write checks membership first (lib/authz.ts).
export default defineSchema({
  toolkitConnections: defineTable({
    organizationId: v.string(),
    baseUrl: v.string(),
    // AES-GCM ciphertext of the toolkit API key. The plain key never leaves the server.
    apiKeyCipher: v.string(),
    // Last four characters, so people can tell keys apart without seeing them.
    apiKeyHint: v.string(),
    status: v.union(v.literal("ok"), v.literal("failing")),
    buildNumber: v.union(v.null(), v.string()),
    lastCheckedAt: v.number(),
    lastError: v.union(v.null(), v.string()),
    createdBy: v.string(),
  }).index("by_organization", ["organizationId"]),

  // One run of one toolkit step, started from the test bench or by an automation run.
  jobs: defineTable({
    organizationId: v.string(),
    connectionId: v.id("toolkitConnections"),
    stepId: v.string(),
    // The step input exactly as validated against the catalog schema.
    input: v.any(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    // Random per-job value the toolkit must present when it posts the result back.
    webhookToken: v.string(),
    toolkitJobId: v.union(v.null(), v.string()),
    // The toolkit's "response" value: a URL, a list of URLs, or structured data.
    result: v.optional(v.any()),
    // Every file URL found in the result, for the outputs library.
    outputs: v.array(v.string()),
    error: v.union(v.null(), v.string()),
    createdBy: v.string(),
    startedAt: v.union(v.null(), v.number()),
    finishedAt: v.union(v.null(), v.number()),
    // When the job was handed to the toolkit. A queued job without it is waiting for a
    // free slot under the team's limit on jobs at once.
    dispatchedAt: v.optional(v.number()),
    // Set when an automation run created the job, so its result moves the run on.
    runStepId: v.optional(v.id("runSteps")),
    // True when the failure is one another try cannot fix, such as a setting the
    // toolkit refuses. A step in a run does not try such a job again.
    permanent: v.optional(v.boolean()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  // Per-team settings. A team without a row uses the defaults.
  teamSettings: defineTable({
    organizationId: v.string(),
    // How many jobs this team may have on the toolkit at the same time.
    maxParallelJobs: v.number(),
    // Set once, used by every automation: a logo and music (an "upload:<id>" pointer to
    // one of the team's uploads, or an address), a colour and a font.
    brand: v.optional(brandValidator),
    // The team's music library. A step that adds music uses the first track unless it
    // picks another by name.
    music: v.optional(musicValidator),
    // How many times a failed step in a run tries again before the run fails.
    stepRetries: v.optional(v.number()),
    // The video editors the team uses, which decides the files an export makes.
    editors: v.optional(v.array(editorValidator)),
  }).index("by_organization", ["organizationId"]),

  // A saved automation: what starts it, and the steps it runs.
  automations: defineTable({
    organizationId: v.string(),
    name: v.string(),
    // Off: only "Run now" starts it. On: its trigger starts it with nobody logged in.
    enabled: v.boolean(),
    trigger: triggerValidator,
    nodes: v.array(nodeValidator),
    edges: v.array(edgeValidator),
    // Secret part of the webhook address that starts this automation.
    hookToken: v.string(),
    // For a schedule trigger: when it next fires. Null otherwise.
    nextRunAt: v.union(v.null(), v.number()),
    // For a watched folder: only files added after this moment start a run, so
    // switching it on never reprocesses what was already there.
    watchFrom: v.optional(v.number()),
    // Changes not yet published. The fields above are the live version, the one triggers
    // run; while the automation is on, edits are kept here until someone publishes them.
    draft: v.optional(
      v.object({
        name: v.string(),
        trigger: triggerValidator,
        nodes: v.array(nodeValidator),
        edges: v.array(edgeValidator),
        updatedBy: v.string(),
        updatedAt: v.number(),
      }),
    ),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_enabled_and_nextRunAt", ["enabled", "nextRunAt"])
    .index("by_enabled_and_trigger_kind", ["enabled", "trigger.kind"]),

  // Files a watched folder has already started a run for, so each starts only one.
  watchedFiles: defineTable({
    automationId: v.id("automations"),
    key: v.string(),
    etag: v.string(),
  }).index("by_automation_and_key", ["automationId", "key"]),

  // One run of an automation. It keeps its own copy of the steps, so editing the
  // automation never changes a run that is already under way.
  runs: defineTable({
    organizationId: v.string(),
    automationId: v.id("automations"),
    automationName: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("waiting"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    triggerKind: v.union(
      v.literal("manual"),
      v.literal("webhook"),
      v.literal("schedule"),
      v.literal("upload"),
      v.literal("folder"),
    ),
    // What the trigger handed over: file_url, the webhook body, the upload's details.
    trigger: v.any(),
    nodes: v.array(nodeValidator),
    edges: v.array(edgeValidator),
    error: v.union(v.null(), v.string()),
    // The person who pressed "Run now"; null when a trigger started it.
    startedBy: v.union(v.null(), v.string()),
    finishedAt: v.union(v.null(), v.number()),
    // How many times steps in this run have tried again after failing.
    retries: v.optional(v.number()),
  })
    .index("by_automation", ["automationId"])
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  // The live state of one step within one run.
  runSteps: defineTable({
    runId: v.id("runs"),
    organizationId: v.string(),
    nodeId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("waiting_approval"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    // One job per incoming file for a one-file step; one job otherwise.
    jobIds: v.array(v.id("jobs")),
    // The file URLs this step hands to the next ones.
    outputs: v.array(v.string()),
    error: v.union(v.null(), v.string()),
    // For a "clips" step, which works in two stages: first it reads each video's length
    // and pauses ("probe"), then it cuts the clips ("cut"). jobIds holds the current
    // stage's jobs.
    // An "if" step reading its files' details is at "check"; a "wait" step is at "wait".
    stage: v.optional(
      v.union(v.literal("probe"), v.literal("cut"), v.literal("check"), v.literal("wait")),
    ),
    // For a finished "if" step: the files that left by each way out. `outputs` holds all
    // of them; a later step is handed only those of the way that leads to it.
    branches: v.optional(v.record(v.string(), v.array(v.string()))),
    // For a "wait" step: when it lets the run carry on.
    resumeAt: v.optional(v.number()),
    // The planned clips, in the same order as the cut jobs.
    plan: v.optional(
      v.array(
        v.object({
          source: v.string(),
          part: v.number(),
          parts: v.number(),
          start: v.number(),
          seconds: v.number(),
        }),
      ),
    ),
    // What is known about each video a "clips" step cut, kept so its cuts can be opened
    // in a video editor later.
    sources: v.optional(
      v.array(
        v.object({
          url: v.string(),
          fps: v.number(),
          width: v.number(),
          height: v.number(),
          duration: v.number(),
          hasAudio: v.boolean(),
          audioChannels: v.optional(v.number()),
          audioSampleRate: v.optional(v.number()),
        }),
      ),
    ),
    // Who approved or rejected, for an approval step.
    decidedBy: v.optional(v.string()),
    // How many times this step has tried again after failing.
    retries: v.optional(v.number()),
    // Set while the step waits to try again: when the next try starts, and why the
    // last one failed.
    retryAt: v.optional(v.number()),
    retryError: v.optional(v.string()),
    startedAt: v.union(v.null(), v.number()),
    finishedAt: v.union(v.null(), v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  // Something the team should know about: a run that failed after all its tries. Shown
  // under the bell to every member until that member has seen it.
  alerts: defineTable({
    organizationId: v.string(),
    kind: v.literal("run_failed"),
    runId: v.id("runs"),
    automationId: v.id("automations"),
    automationName: v.string(),
    // The step that failed, as it is named on the canvas.
    stepName: v.optional(v.string()),
    message: v.string(),
    // How many times that step tried again before giving up.
    retries: v.number(),
    // The members who have seen it.
    seenBy: v.array(v.string()),
  }).index("by_organization", ["organizationId"]),

  // A team's own S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces).
  storageConnections: defineTable({
    organizationId: v.string(),
    endpoint: v.string(),
    region: v.string(),
    bucket: v.string(),
    accessKeyId: v.string(),
    // AES-GCM ciphertext of the secret access key.
    secretCipher: v.string(),
    createdBy: v.string(),
  }).index("by_organization", ["organizationId"]),

  // Files people upload from the browser. The bytes go straight to the team's bucket;
  // this row only records where they are.
  uploads: defineTable({
    organizationId: v.string(),
    key: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    status: v.union(v.literal("uploading"), v.literal("ready")),
    createdBy: v.string(),
    // "brand" for a logo or a music track added in Settings. Those are kept to be used
    // by steps, so they never start an automation.
    purpose: v.optional(v.literal("brand")),
    // Read from the file by the toolkit once the upload finishes. Missing while that is
    // still to happen, or when the toolkit could not read the file.
    details: v.optional(fileDetailsValidator),
  }).index("by_organization", ["organizationId"]),
});
