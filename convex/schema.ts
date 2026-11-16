import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const nodeValidator = v.object({
  id: v.string(),
  kind: v.union(v.literal("step"), v.literal("approval")),
  stepId: v.optional(v.string()),
  label: v.optional(v.string()),
  input: v.record(v.string(), v.any()),
  position: v.object({ x: v.number(), y: v.number() }),
});

export const edgeValidator = v.object({ id: v.string(), source: v.string(), target: v.string() });

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
  }),
  // A folder in the team's own bucket, checked every minute for new files.
  v.object({ kind: v.literal("folder"), prefix: v.string(), fileType: fileTypeValidator }),
);

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
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  // Per-team settings. A team without a row uses the defaults.
  teamSettings: defineTable({
    organizationId: v.string(),
    // How many jobs this team may have on the toolkit at the same time.
    maxParallelJobs: v.number(),
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
    // Who approved or rejected, for an approval step.
    decidedBy: v.optional(v.string()),
    startedAt: v.union(v.null(), v.number()),
    finishedAt: v.union(v.null(), v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_organization_and_status", ["organizationId", "status"]),

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
  }).index("by_organization", ["organizationId"]),
});
