import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { drawingValidator } from "./lib/drawing";
import { tourIdValidator } from "./lib/tours";

export const nodeValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("step"),
    v.literal("approval"),
    v.literal("clips"),
    v.literal("export"),
    v.literal("if"),
    v.literal("wait"),
    // Runs another of the team's automations on its files.
    v.literal("automation"),
    // Picks the best moments of each video and cuts them; groups a video into chapters.
    v.literal("moments"),
    v.literal("chapters"),
    // Lays cutaway footage over each video; has the AI plan where and what first.
    v.literal("broll"),
    v.literal("broll-plan"),
    // Draws motion graphics, or adds sound effects, onto each video.
    v.literal("motion"),
    v.literal("sound-effects"),
    // Has the AI plan which motion graphics go where, for the Add Motion Graphics after it.
    v.literal("motion-plan"),
  ),
  stepId: v.optional(v.string()),
  label: v.optional(v.string()),
  // Turned off: runs hand its files straight on without doing its work.
  off: v.optional(v.boolean()),
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

/** What a slot in a project holds, which decides the files it takes. */
export const deliverableKindValidator = v.union(
  // The full-length video, such as a podcast episode.
  v.literal("video"),
  v.literal("short"),
  v.literal("thumbnail"),
  v.literal("audio"),
  // Anything else the team agreed to deliver.
  v.literal("other"),
);

/** Where a deliverable is, as a column on the project's board. */
export const deliverableStatusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("review"),
  v.literal("approved"),
  v.literal("published"),
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
  // A run of another of the team's automations ended. `automationId` is "" until picked.
  v.object({
    kind: v.literal("finished"),
    automationId: v.string(),
    when: v.union(v.literal("done"), v.literal("failed"), v.literal("either")),
  }),
  v.object({
    kind: v.literal("slot"),
    status: deliverableStatusValidator,
    slotKind: v.union(v.literal("any"), deliverableKindValidator),
  }),
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
    join: v.optional(v.array(v.string())),
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
  v.object({ op: v.literal("switch"), id: v.string(), on: v.boolean() }),
  v.object({ op: v.literal("duplicate"), ids: v.array(v.string()) }),
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

export const libraryKindValidator = v.union(
  v.literal("video"),
  v.literal("audio"),
  v.literal("image"),
  v.literal("other"),
);

export const agentSettingsValidator = v.object({
  model: v.union(v.string(), v.null()),
  houseRules: v.string(),
  platforms: v.array(v.string()),
});

export const brandValidator = v.object({
  logo: v.optional(v.string()),
  color: v.optional(v.string()),
  font: v.optional(v.string()),
  music: v.optional(v.string()),
  card: v.optional(v.string()),
  intro: v.optional(v.string()),
  outro: v.optional(v.string()),
});

const captionLookValidator = v.object({
  style: v.optional(
    v.union(
      v.literal("highlight"),
      v.literal("karaoke"),
      v.literal("word_by_word"),
      v.literal("underline"),
      v.literal("classic"),
    ),
  ),
  font_family: v.optional(v.string()),
  font_size: v.optional(v.number()),
  bold: v.optional(v.boolean()),
  all_caps: v.optional(v.boolean()),
  max_words_per_line: v.optional(v.number()),
  line_color: v.optional(v.string()),
  word_color: v.optional(v.string()),
  outline_color: v.optional(v.string()),
  outline_width: v.optional(v.number()),
  shadow_offset: v.optional(v.number()),
  position: v.optional(
    v.union(v.literal("top_center"), v.literal("middle_center"), v.literal("bottom_center")),
  ),
});

/** A team's captions: misheard words and how to write them, saved looks, a look per shape. */
export const captionSetupValidator = v.object({
  fixes: v.array(v.object({ find: v.string(), replace: v.string() })),
  styles: v.array(v.object({ name: v.string(), look: captionLookValidator })),
  byShape: v.object({
    vertical: v.optional(v.string()),
    wide: v.optional(v.string()),
    square: v.optional(v.string()),
  }),
});

/** A team's Motion settings: the preset picked, its style as changed, and the names shown. */
export const motionSetupValidator = v.object({
  preset: v.string(),
  style: v.object({
    look: v.string(),
    busy: v.string(),
    pieces: v.array(v.string()),
    opening: v.string(),
    ending: v.string(),
    sound: v.string(),
    showsUnsaid: v.boolean(),
  }),
  hostName: v.string(),
  hostRole: v.string(),
  handle: v.string(),
  callToAction: v.string(),
  notes: v.string(),
});

// Users, sessions, organizations (teams), members and invitations live in the
// Better Auth component (convex/betterAuth). App tables point at a team by its
// organization id, and every read or write checks membership first (lib/authz.ts).
// For one kind of news: whether it shows under the bell, is emailed, and goes to each
// chat app the member linked. Left out: the kind's default.
const kindChannels = v.object({
  bell: v.optional(v.boolean()),
  email: v.optional(v.boolean()),
  telegram: v.optional(v.boolean()),
  slack: v.optional(v.boolean()),
  discord: v.optional(v.boolean()),
  teams: v.optional(v.boolean()),
});

const chatAppValidator = v.union(
  v.literal("telegram"),
  v.literal("slack"),
  v.literal("discord"),
  v.literal("teams"),
);

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
    // The bucket the toolkit keeps files in, as it reported at the last check. Uploads,
    // the Files page, review playback and exports all go through the toolkit to it, so a
    // team never enters storage keys here. Missing until a check has read it.
    storage: v.optional(
      v.object({
        bucket: v.string(),
        // The two addresses the toolkit's output links start with (its S3_ENDPOINT_URL and
        // S3_PUBLIC_URL), so links can be followed when a file is renamed or moved.
        endpoint: v.union(v.null(), v.string()),
        publicUrl: v.union(v.null(), v.string()),
      }),
    ),
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
    // When the dashboard last asked the toolkit about a running job whose result is late.
    lastAskedAt: v.optional(v.number()),
    // Set when the library asked for the job, to make one of its files searchable.
    libraryItemId: v.optional(v.id("libraryItems")),
    // Set when the job brings a Zoom recording into the team's folder.
    zoomImportId: v.optional(v.id("zoomImports")),
    // Set when the job brings a Google Meet recording into the team's folder.
    googleMeetImportId: v.optional(v.id("googleMeetImports")),
    microsoftImportId: v.optional(v.id("microsoftImports")),
    // Set when the job brings a file from a watched Dropbox folder into the team's folder.
    dropboxImportId: v.optional(v.id("dropboxImports")),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_status", ["status"]),

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
    // How the agent works for this team: its model, house rules and default platforms.
    agent: v.optional(agentSettingsValidator),
    // How captions read and look: word fixes, saved styles and a style per video shape.
    captions: v.optional(captionSetupValidator),
    // How motion graphics and sound effects look and sound (Settings > Motion).
    motion: v.optional(motionSetupValidator),
    // The team's own Anthropic API key, when it brings one: the agent and the AI steps then
    // run on the team's Anthropic account (anthropicKey.ts). Kept encrypted; only the agent
    // server reads it back, never a member's browser.
    anthropicKey: v.optional(
      v.object({ cipher: v.string(), hint: v.string(), setBy: v.string(), setAt: v.number() }),
    ),
    // What the team makes and where it posts, from setting up (content-goals.ts). The
    // posting apps also become the agent's default platforms.
    contentGoals: v.optional(
      v.object({ kinds: v.array(v.string()), apps: v.array(v.string()), answeredAt: v.number() }),
    ),
  }).index("by_organization", ["organizationId"]),

  // A saved automation: what starts it, and the steps it runs.
  // Sticky notes on an automation's canvas, for the team. Not part of its versions: they
  // explain the automation and never change what it does, so they save as they are typed.
  // Keys that let Claude and other AI agents reach the team through the dashboard's MCP
  // server (convex/mcp.ts). Only a hash of each key is kept; the key is shown once.
  mcpKeys: defineTable({
    organizationId: v.string(),
    name: v.string(),
    hash: v.string(),
    // The key's last four characters, to tell keys apart.
    hint: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.union(v.null(), v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_hash", ["hash"]),

  // AI agents that registered themselves to sign in with OAuth (RFC 7591). Agents that
  // name themselves by a metadata document address are not stored here.
  oauthClients: defineTable({
    clientId: v.string(),
    name: v.string(),
    uri: v.union(v.null(), v.string()),
    redirectUris: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_client", ["clientId"]),

  // An agent asking to sign in: shown to the person on /connect/<id>. Once they allow it,
  // it holds the code the agent swaps for tokens (stored as a hash), used once.
  oauthRequests: defineTable({
    clientId: v.string(),
    clientName: v.string(),
    clientUri: v.union(v.null(), v.string()),
    redirectUri: v.string(),
    state: v.union(v.null(), v.string()),
    codeChallenge: v.string(),
    expiresAt: v.number(),
    userId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    codeHash: v.optional(v.string()),
    codeExpiresAt: v.optional(v.number()),
  }).index("by_code", ["codeHash"]),

  // An agent someone let in: it acts as that person, on one team, with their role there.
  // Tokens are stored as hashes; the refresh token changes each time it is used.
  oauthGrants: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    clientId: v.string(),
    clientName: v.string(),
    accessHash: v.string(),
    accessExpiresAt: v.number(),
    refreshHash: v.string(),
    refreshExpiresAt: v.number(),
    createdAt: v.number(),
    lastUsedAt: v.union(v.null(), v.number()),
  })
    .index("by_access", ["accessHash"])
    .index("by_refresh", ["refreshHash"])
    .index("by_organization", ["organizationId"]),

  // A team's own FFmpeg steps, written by the agent (or a person) when no ready-made step
  // fits: a compose request with {{name}} blanks. See step-catalog's team-steps.ts.
  teamSteps: defineTable({
    organizationId: v.string(),
    title: v.string(),
    description: v.string(),
    blanks: v.array(
      v.object({
        name: v.string(),
        label: v.string(),
        kind: v.union(
          v.literal("file"),
          v.literal("text"),
          v.literal("number"),
          v.literal("color"),
          v.literal("choice"),
        ),
        default: v.optional(v.union(v.string(), v.number())),
        min: v.optional(v.number()),
        max: v.optional(v.number()),
        options: v.optional(v.array(v.string())),
        whole: v.optional(v.boolean()),
      }),
    ),
    primary: v.union(v.string(), v.null()),
    request: v.any(),
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  automationNotes: defineTable({
    organizationId: v.string(),
    automationId: v.id("automations"),
    text: v.string(),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_automation", ["automationId"]),

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
        // Set when the draft began as an earlier version brought back; its number.
        restoredFrom: v.optional(v.number()),
      }),
    ),
    createdBy: v.string(),
    updatedAt: v.number(),
    // The client this automation works for. Its runs use that client's brand over the
    // team's, and keep their finished files in the client's folder. Not part of versions.
    clientId: v.optional(v.id("clients")),
    // Switched on: each finished run's files are also sent to this Dropbox account, into
    // `folder` (or "/Kontifi/<automation>"). Not part of versions.
    dropboxSend: v.optional(
      v.object({
        connectionId: v.id("dropboxConnections"),
        folder: v.optional(v.string()),
        by: v.string(),
      }),
    ),
  })
    .index("by_organization", ["organizationId"])
    .index("by_client", ["clientId"])
    .index("by_enabled_and_nextRunAt", ["enabled", "nextRunAt"])
    .index("by_enabled_and_trigger_kind", ["enabled", "trigger.kind"]),

  // Files a watched folder has already started a run for, so each starts only one.
  // Every version an automation has had as its live version, numbered from 1, so an
  // earlier one can be looked at and brought back. The newest 100 are kept.
  automationVersions: defineTable({
    automationId: v.id("automations"),
    organizationId: v.string(),
    number: v.number(),
    name: v.string(),
    trigger: triggerValidator,
    nodes: v.array(nodeValidator),
    edges: v.array(edgeValidator),
    // How it became live: made new, saved while off, published from a draft, or imported.
    source: v.union(
      v.literal("created"),
      v.literal("saved"),
      v.literal("published"),
      v.literal("imported"),
    ),
    // When it was an earlier version brought back, that version's number.
    restoredFrom: v.optional(v.number()),
    byId: v.string(),
    byName: v.string(),
  }).index("by_automation_and_number", ["automationId", "number"]),

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
      // Another automation's run ended, and this one follows it.
      v.literal("finished"),
      // A "Run an automation" step in another run started it.
      v.literal("automation"),
      // A project slot moved to the status its trigger waits for.
      v.literal("slot"),
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
    // How many times someone picked this run up where it stopped after it failed.
    pickedUp: v.optional(v.number()),
    // Set when someone tested one step on its own: that step's node id. Nobody is
    // alerted when a test fails, since the person testing is watching it.
    test: v.optional(v.string()),
    // For a run another run started, by a "Run an automation" step or by following it:
    // that run, and the step when a step started it. When the step waits, this run's end
    // moves that step on.
    parentRunId: v.optional(v.id("runs")),
    parentRunStepId: v.optional(v.id("runSteps")),
    // The automations whose runs led to this one, the first one first, this one last. A
    // run never starts one of them again, nor goes deeper than MAX_CHAIN_DEPTH.
    chain: v.optional(v.array(v.id("automations"))),
    // The client the automation was for when the run started.
    clientId: v.optional(v.id("clients")),
    // The project the run works for, and the slot it started from. Its finished files
    // fill the project's empty slots.
    projectId: v.optional(v.id("projects")),
    deliverableId: v.optional(v.id("deliverables")),
  })
    .index("by_automation", ["automationId"])
    .index("by_parentRun", ["parentRunId"])
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
    // A "moments" or "chapters" step first transcribes each video with word timestamps
    // ("listen"), then waits for the model to pick ("pick"); a "moments" step then cuts
    // its moments ("cut").
    // A caption step reading its videos' sizes, to pick the style for each shape, is at "size".
    // An Add B-Roll step listens too, then finds footage ("match"), has the picture model
    // look at the words and the stock found ("look"), and lays the cutaways over ("lay").
    // A "motion" or "sound-effects" step transcribes each video ("listen"), reads its words
    // and places what goes on it ("place"), then draws on it ("render").
    stage: v.optional(
      v.union(
        v.literal("probe"),
        v.literal("cut"),
        v.literal("check"),
        v.literal("wait"),
        v.literal("listen"),
        v.literal("pick"),
        v.literal("size"),
        v.literal("match"),
        v.literal("look"),
        v.literal("lay"),
        v.literal("place"),
        v.literal("render"),
      ),
    ),
    // For a finished "if" step: the files that left by each way out. `outputs` holds all
    // of them; a later step is handed only those of the way that leads to it.
    branches: v.optional(v.record(v.string(), v.array(v.string()))),
    // For a "wait" step: when it lets the run carry on.
    resumeAt: v.optional(v.number()),
    // For a "Run an automation" step: the run it started.
    childRunId: v.optional(v.id("runs")),
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
    // For a "moments" step: the moments it picked, best first, in the order of the cut
    // jobs and `plan`. Each one's edges are snapped to the transcript's words.
    moments: v.optional(
      v.array(
        v.object({
          source: v.string(),
          start: v.number(),
          end: v.number(),
          title: v.string(),
          why: v.string(),
          text: v.string(),
        }),
      ),
    ),
    // For a "chapters" step: the chapters of each video, in order.
    chapters: v.optional(
      v.array(
        v.object({
          source: v.string(),
          start: v.number(),
          title: v.string(),
          bullets: v.array(v.string()),
        }),
      ),
    ),
    // For a "motion" or "sound-effects" step: what it put on each video and when, so a
    // later step (such as B-roll) can keep clear of it.
    placed: v.optional(
      v.array(
        v.object({
          source: v.string(),
          items: v.array(v.object({ start: v.number(), end: v.number(), kind: v.string() })),
        }),
      ),
    ),
    // What a "moments" or "chapters" step left out, said plainly ("2 picks were left out…").
    pickNote: v.optional(v.string()),
    // What a Plan step decided, for the step that carries it out (automation-core plans.ts).
    // For Plan B-Roll: per video, the moments to cover and what to show.
    aiPlan: v.optional(v.any()),
    // While an Add B-Roll step finds footage: the moments and the footage that could cover
    // them, between "match" and "look". Cleared once the cutaways are chosen.
    brollWork: v.optional(v.any()),
    // For a finished Add B-Roll step: the cutaways laid over each video.
    cutaways: v.optional(
      v.array(
        v.object({
          source: v.string(),
          start: v.number(),
          end: v.number(),
          said: v.string(),
          show: v.string(),
          kind: v.union(v.literal("library"), v.literal("stock")),
          ref: v.string(),
          title: v.string(),
          score: v.number(),
          credit: v.optional(v.object({ site: v.string(), page: v.string(), by: v.string() })),
        }),
      ),
    ),
    // Who approved or rejected, for an approval step.
    decidedBy: v.optional(v.string()),
    // For an approval step: the reviewers it named when the run reached it (empty for the
    // whole team), when it decides by itself if nobody has, and whether it did.
    reviewers: v.optional(v.array(v.string())),
    decideBy: v.optional(v.number()),
    decidedAutomatically: v.optional(v.boolean()),
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

  // A video's words with when each is said, from a transcript made with word timestamps,
  // kept so the same video is not transcribed again (Find more moments, Chapters after
  // Best moments). `source` is the file's address without its query, so a fresh signed
  // link to the same file still finds it. t: the word, s: start, e: end, in seconds.
  spokenWords: defineTable({
    organizationId: v.string(),
    source: v.string(),
    words: v.array(v.object({ t: v.string(), s: v.number(), e: v.number() })),
    duration: v.number(),
  }).index("by_source", ["organizationId", "source"]),

  // The model's answer to a Best moments or Chapters question, kept so the same question
  // (the same transcript, settings and house rules) is not paid for twice. `question` is
  // the question's SHA-256. Forgotten after 30 days (crons.ts).
  pickAnswers: defineTable({
    organizationId: v.string(),
    question: v.string(),
    answer: v.string(),
    savedAt: v.number(),
  })
    .index("by_question", ["organizationId", "question"])
    .index("by_saved", ["savedAt"]),

  // Questions of an unattended run's pick, sent to Anthropic as one batch at half the
  // price; checked until the answers are in (moments.checkBatch).
  pickBatches: defineTable({
    organizationId: v.string(),
    runStepId: v.id("runSteps"),
    batchId: v.string(),
    sentAt: v.number(),
    checks: v.number(),
  }).index("by_step", ["runStepId"]),

  // A moment a Best moments step cut from a video, so a later run on the same video can
  // find new ones instead of the same again.
  pickedMoments: defineTable({
    organizationId: v.string(),
    source: v.string(),
    start: v.number(),
    end: v.number(),
    runId: v.id("runs"),
  }).index("by_source", ["organizationId", "source"]),

  // Something people should know about: a run that failed after all its tries, an
  // approval waiting or run out of time, a mention in a review. Shown under the bell to
  // the members it is for until each has seen it, unless they switched that kind off in
  // their notification settings.
  alerts: defineTable({
    organizationId: v.string(),
    // "run_failed": a run ended with a failed step. "approval_waiting": a run reached an
    // approval step and waits for the people in `recipients` to decide.
    // "approval_timed_out": nobody decided in time, so the step decided by itself.
    // "mention": someone wrote @ and a member's name in a review comment.
    // "client_feedback": a client commented or gave their verdict through a share link.
    kind: v.union(
      v.literal("run_failed"),
      v.literal("approval_waiting"),
      v.literal("approval_timed_out"),
      v.literal("mention"),
      v.literal("client_feedback"),
      // "ready_for_review": a new version went into a project's slot and waits for review.
      v.literal("ready_for_review"),
      // "clip_finished": a run is done and its finished files were kept in Files.
      v.literal("clip_finished"),
    ),
    // The members it is for. Left out: everyone on the team.
    recipients: v.optional(v.array(v.string())),
    // For "approval_waiting": the step waiting. The alert goes once it is decided.
    runStepId: v.optional(v.id("runSteps")),
    // The run it is about. Left out for a mention in a review.
    runId: v.optional(v.id("runs")),
    automationId: v.optional(v.id("automations")),
    // The automation's name, or for a mention the review's title.
    automationName: v.string(),
    // The step that failed, as it is named on the canvas.
    stepName: v.optional(v.string()),
    message: v.string(),
    // How many times that step tried again before giving up.
    retries: v.number(),
    // For a mention or client feedback: the review, clip and thread, and who wrote it.
    reviewId: v.optional(v.id("reviews")),
    clipId: v.optional(v.id("reviewClips")),
    commentId: v.optional(v.id("reviewComments")),
    from: v.optional(v.string()),
    // The members who have seen it.
    seenBy: v.array(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_runStep", ["runStepId"]),

  // A team's own Slack app, so its people can talk to the agent in Slack. One Slack
  // workspace belongs to one team. The token and signing secret are stored encrypted and
  // never leave the server.
  slackConnections: defineTable({
    organizationId: v.string(),
    slackTeamId: v.string(),
    slackTeamName: v.string(),
    botUserId: v.string(),
    botTokenCipher: v.string(),
    signingSecretCipher: v.string(),
    connectedBy: v.string(),
    connectedAt: v.number(),
    // The channel review activity is posted to: new reviews, client feedback, mentions.
    // Left out: nothing is posted.
    alertChannelId: v.optional(v.string()),
    alertChannelName: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_slack_team", ["slackTeamId"]),

  // A review comment thread and the Slack thread it was posted as. Replies written in
  // that Slack thread come back to the review thread, and the other way round.
  slackThreads: defineTable({
    organizationId: v.string(),
    slackTeamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
  })
    .index("by_comment", ["commentId"])
    .index("by_slack_thread", ["slackTeamId", "channelId", "threadTs"])
    .index("by_review", ["reviewId"]),

  // Slack messages already brought into a review, so Slack sending one again (it does,
  // when an answer is slow) does not add it twice.
  slackReplies: defineTable({
    slackTeamId: v.string(),
    channelId: v.string(),
    ts: v.string(),
    commentId: v.id("reviewComments"),
  }).index("by_message", ["slackTeamId", "channelId", "ts"]),

  // Who a Slack user is on the dashboard, found by their email address, and the
  // sign-in the agent uses to act as them. Rows go when the connection goes.
  slackPeople: defineTable({
    slackTeamId: v.string(),
    slackUserId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    sessionToken: v.string(),
    sessionExpiresAt: v.number(),
  }).index("by_slack_user", ["slackTeamId", "slackUserId"]),

  // Discord servers a team added the dashboard's one Discord bot to. The bot itself is
  // the deployment's (DISCORD_* env on the agent server and here), never a team's.
  discordServers: defineTable({
    organizationId: v.string(),
    guildId: v.string(),
    guildName: v.string(),
    addedBy: v.string(),
    addedAt: v.number(),
    // The channel in this server review activity is posted to, when the team picked one
    // here. A team has at most one such channel across its servers.
    alertChannelId: v.optional(v.string()),
    alertChannelName: v.optional(v.string()),
    // The webhook in that channel that copies a teammate's reply under their own name
    // and picture. Made the first time it is needed; its token is kept encrypted.
    reviewWebhook: v.optional(
      v.object({ channelId: v.string(), id: v.string(), tokenCipher: v.string() }),
    ),
  })
    .index("by_organization", ["organizationId"])
    .index("by_guild", ["guildId"]),

  // A review comment thread as a Discord thread in the team's review channel: what
  // follows in the room goes there, and a teammate's reply there comes back.
  discordReviewThreads: defineTable({
    organizationId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
  })
    .index("by_comment", ["commentId"])
    .index("by_thread", ["threadId"])
    .index("by_review", ["reviewId"]),

  // Discord messages already brought into a review, so one is never added twice.
  discordReplies: defineTable({
    messageId: v.string(),
    commentId: v.id("reviewComments"),
  }).index("by_message", ["messageId"]),

  // A team member's own Discord account, linked by signing in with Discord once. Discord
  // gives bots no email address, so this is how the agent knows who wrote to it. The
  // sign-in the agent acts with is kept here and renewed when it runs low.
  discordPeople: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    discordUserId: v.string(),
    discordName: v.string(),
    linkedAt: v.number(),
    sessionToken: v.optional(v.string()),
    sessionExpiresAt: v.optional(v.number()),
  })
    .index("by_discord_user", ["discordUserId", "organizationId"])
    .index("by_member", ["organizationId", "userId"]),

  // A Discord sign-in someone started from Settings, matched when Discord sends them back.
  discordLinkStarts: defineTable({
    nonce: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    kind: v.union(v.literal("server"), v.literal("person")),
    createdAt: v.number(),
  }).index("by_nonce", ["nonce"]),

  // The Microsoft organization (Entra tenant) a team linked for the agent in Microsoft
  // Teams. The bot is the deployment's (TEAMS_APP_* env here and on the agent server),
  // never a team's. One organization belongs to one team. Alerts can post to one channel.
  teamsTenants: defineTable({
    organizationId: v.string(),
    tenantId: v.string(),
    tenantName: v.string(),
    addedBy: v.string(),
    addedAt: v.number(),
    alertConversationId: v.optional(v.string()),
    alertServiceUrl: v.optional(v.string()),
    alertChannelName: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_tenant", ["tenantId"]),

  // Teams (Microsoft Teams' own teams) the bot was seen in, so Settings can offer their
  // channels for alerts. Recorded when someone writes to the agent there.
  teamsTeams: defineTable({
    organizationId: v.string(),
    tenantId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
    serviceUrl: v.string(),
    seenAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_team", ["teamId"]),

  // A team member's own Microsoft account, linked by signing in once (or found from their
  // Microsoft 365 connection). Teams says who wrote by their Entra object id.
  teamsPeople: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    aadObjectId: v.string(),
    name: v.string(),
    linkedAt: v.number(),
    sessionToken: v.optional(v.string()),
    sessionExpiresAt: v.optional(v.number()),
  })
    .index("by_aad_user", ["aadObjectId", "organizationId"])
    .index("by_member", ["organizationId", "userId"]),

  // A Microsoft sign-in for Teams someone started from Settings.
  teamsLinkStarts: defineTable({
    nonce: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    kind: v.union(v.literal("organization"), v.literal("person")),
    createdAt: v.number(),
  }).index("by_nonce", ["nonce"]),

  // A team member's own Zoom account, connected from Settings so the cloud recordings of
  // meetings they host come into the team's uploads. The dashboard has ONE Zoom app, set
  // up once by whoever runs it (ZOOM_* env). One Zoom account belongs to one team. The
  // tokens are stored encrypted and never leave the server.
  zoomConnections: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    zoomUserId: v.string(),
    zoomAccountId: v.string(),
    zoomEmail: v.string(),
    zoomName: v.string(),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    // When the access token stops working.
    expiresAt: v.number(),
    connectedAt: v.number(),
    // False: new recordings wait to be brought in by hand from Settings.
    autoImport: v.boolean(),
    // True: a Zoom account admin connected the WHOLE Zoom account through the dashboard's
    // second, admin-managed Zoom app (ZOOM_ACCOUNT_* env), so every host's recordings in
    // that account come in. zoomUserId is then the admin who connected it.
    wholeAccount: v.optional(v.boolean()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_member", ["organizationId", "userId"])
    .index("by_zoom_user", ["zoomUserId"])
    .index("by_zoom_account", ["zoomAccountId"]),

  // A Zoom sign-in someone started from Settings, matched when Zoom sends them back.
  zoomLinkStarts: defineTable({
    nonce: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    // True: connecting the whole Zoom account, through the admin-managed app.
    wholeAccount: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_nonce", ["nonce"]),

  // One Zoom recording being brought in, or brought in: the toolkit streams the file from
  // Zoom straight into the team's folder, then it becomes an upload like any other.
  zoomImports: defineTable({
    organizationId: v.string(),
    connectionId: v.id("zoomConnections"),
    meetingUuid: v.string(),
    // Zoom's id for the one file brought in (the best video of the meeting).
    recordingFileId: v.string(),
    topic: v.string(),
    startTime: v.number(),
    status: v.union(v.literal("importing"), v.literal("done"), v.literal("failed")),
    uploadId: v.optional(v.id("uploads")),
    jobId: v.optional(v.id("jobs")),
    error: v.optional(v.string()),
    // The download token Zoom sent with the event (good for a day), encrypted. Left out
    // for a recording brought in by hand: the account's own sign-in is used.
    downloadTokenCipher: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_file", ["organizationId", "recordingFileId"])
    .index("by_job", ["jobId"]),

  // A team member's own Google account, connected from Settings so the Meet recordings of
  // meetings they organize come into the team's uploads. The dashboard has ONE Google Cloud
  // app, set up once by whoever runs it (GOOGLE_MEET_* env). One Google account belongs to
  // one team. The tokens are stored encrypted and never leave the server.
  googleMeetConnections: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    // Google's own id for the account ("sub").
    googleUserId: v.string(),
    googleEmail: v.string(),
    googleName: v.string(),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    // When the access token stops working.
    expiresAt: v.number(),
    connectedAt: v.number(),
    // False: new recordings wait to be brought in by hand from Settings.
    autoImport: v.boolean(),
    // Recordings of meetings that end after this come in by themselves.
    watchFrom: v.number(),
    // Set while recordings other people share with this account come in by themselves
    // too: those Meet saves after this time.
    sharedFrom: v.optional(v.number()),
    // True when Google let the dashboard read calendar events, to name recordings Meet
    // saved under a meeting code. Missing on accounts connected before it asked.
    calendar: v.optional(v.boolean()),
    // Set when Google stopped accepting the sign-in (taken back, or run out).
    signInLostAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_member", ["organizationId", "userId"])
    .index("by_google_user", ["googleUserId"]),

  // A Google sign-in someone started from Settings, matched when Google sends them back.
  googleMeetLinkStarts: defineTable({
    nonce: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    createdAt: v.number(),
  }).index("by_nonce", ["nonce"]),

  // One Meet recording being brought in, or brought in: the toolkit streams the file from
  // the organizer's Drive straight into the team's folder, then it becomes an upload.
  googleMeetImports: defineTable({
    organizationId: v.string(),
    connectionId: v.id("googleMeetConnections"),
    // Meet's name for the recording (conferenceRecords/<id>/recordings/<id>), when it was
    // found through Meet. Missing for one brought in from the list of Drive recordings.
    recordingName: v.optional(v.string()),
    driveFileId: v.string(),
    topic: v.string(),
    startTime: v.number(),
    // "duplicate": the file was already in Uploads some other way (uploadId points at it),
    // so it was not brought in again.
    status: v.union(
      v.literal("importing"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("duplicate"),
    ),
    uploadId: v.optional(v.id("uploads")),
    jobId: v.optional(v.id("jobs")),
    error: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_file", ["organizationId", "driveFileId"]),

  // A team member's own Microsoft 365 account, connected from Settings so the Teams
  // meeting recordings Teams saves to their OneDrive come into the team's uploads. The
  // dashboard has ONE Microsoft app (MICROSOFT_* env). One Microsoft account belongs to
  // one team. Tokens are stored encrypted and never leave the server.
  microsoftConnections: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    msUserId: v.string(),
    msEmail: v.string(),
    msName: v.string(),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    // When the access token stops working.
    expiresAt: v.number(),
    connectedAt: v.number(),
    // False: new recordings wait to be brought in by hand from Settings.
    autoImport: v.boolean(),
    // The OneDrive folder Teams saves recordings to, once it has been found.
    recordingsFolderId: v.optional(v.string()),
    // Microsoft's watch on the OneDrive, which tells the dashboard when files change.
    subscriptionId: v.optional(v.string()),
    subscriptionExpiresAt: v.optional(v.number()),
    // Sent back with every change notice, so a notice from anyone else is ignored.
    clientState: v.optional(v.string()),
    // Set when Microsoft stopped accepting the sign-in: the member connects again.
    needsReconnect: v.optional(v.boolean()),
    lastCheckedAt: v.optional(v.number()),
    // The member let the dashboard read files shared with them (Files.Read.All).
    sharedGranted: v.optional(v.boolean()),
    // Recordings of other people's meetings, shared with the member, come in too. Only
    // ones made after sharedSince, when it was switched on.
    includeShared: v.optional(v.boolean()),
    sharedSince: v.optional(v.number()),
    // The member let the dashboard list their Teams channels and read channel files
    // (Team.ReadBasic.All, Channel.ReadBasic.All, Files.Read.All).
    channelsGranted: v.optional(v.boolean()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_member", ["organizationId", "userId"])
    .index("by_ms_user", ["msUserId"])
    .index("by_subscription", ["subscriptionId"]),

  // A Microsoft sign-in someone started from Settings, matched when Microsoft sends them back.
  microsoftLinkStarts: defineTable({
    nonce: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    createdAt: v.number(),
    // Started from the "shared with me" switch: asks for reading shared files too.
    shared: v.optional(v.boolean()),
    // Started from "Add a channel": asks for listing the member's Teams channels and
    // reading their files too.
    channels: v.optional(v.boolean()),
  }).index("by_nonce", ["nonce"]),

  // A Teams channel a member watches for meeting recordings. Recordings of meetings held
  // in a channel are saved in the channel's SharePoint files, in a Recordings folder, not
  // in anyone's OneDrive. New ones made after `since` come into the team's uploads.
  microsoftChannels: defineTable({
    organizationId: v.string(),
    connectionId: v.id("microsoftConnections"),
    teamId: v.string(),
    teamName: v.string(),
    channelId: v.string(),
    channelName: v.string(),
    // The SharePoint drive the channel's files are in, and the channel's folder there.
    driveId: v.string(),
    folderId: v.string(),
    // The Recordings folder inside it, once Teams has made one.
    recordingsFolderId: v.optional(v.string()),
    since: v.number(),
  })
    .index("by_connection", ["connectionId"])
    .index("by_organization", ["organizationId"]),

  // One Teams recording being brought in, or brought in: the toolkit streams the file from
  // OneDrive straight into the team's folder, then it becomes an upload like any other.
  microsoftImports: defineTable({
    organizationId: v.string(),
    connectionId: v.id("microsoftConnections"),
    // OneDrive's id for the recording's file.
    itemId: v.string(),
    // The OneDrive it is in, when it was shared with the member; none for their own.
    driveId: v.optional(v.string()),
    topic: v.string(),
    startTime: v.number(),
    status: v.union(v.literal("importing"), v.literal("done"), v.literal("failed")),
    uploadId: v.optional(v.id("uploads")),
    jobId: v.optional(v.id("jobs")),
    error: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_item", ["organizationId", "itemId"]),

  // A team member's own Dropbox, connected from Settings. Files added to the folders they
  // pick to watch (their own, or team folders they can open) come into the team's
  // uploads, and automations can send finished files back. The dashboard has ONE Dropbox
  // app (DROPBOX_APP_KEY, DROPBOX_APP_SECRET). One Dropbox account belongs to one team.
  // Tokens are stored encrypted and never leave the server.
  dropboxConnections: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    accountId: v.string(),
    email: v.string(),
    name: v.string(),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    // When the access token stops working.
    expiresAt: v.number(),
    connectedAt: v.number(),
    // False: new files in watched folders wait to be brought in by hand from Settings.
    autoImport: v.boolean(),
    // For a Dropbox team account: the team space's top folder, so team folders show up
    // beside the member's own. Missing for a personal Dropbox.
    rootNamespaceId: v.optional(v.string()),
    // Set when Dropbox stopped accepting the sign-in: the member connects again.
    needsReconnect: v.optional(v.boolean()),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_member", ["organizationId", "userId"])
    .index("by_account", ["accountId"]),

  // A Dropbox sign-in someone started from Settings, matched when Dropbox sends them back.
  dropboxLinkStarts: defineTable({
    nonce: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    createdAt: v.number(),
  }).index("by_nonce", ["nonce"]),

  // A Dropbox folder a member watches. Its subfolders are watched too. `cursor` is where
  // Dropbox's list of changes in it was read up to.
  dropboxFolders: defineTable({
    organizationId: v.string(),
    connectionId: v.id("dropboxConnections"),
    path: v.string(),
    pathLower: v.string(),
    cursor: v.optional(v.string()),
    // false: only the files right in this folder (folders picked from the scan list).
    // Missing: this folder and every folder inside it.
    recursive: v.optional(v.boolean()),
    addedAt: v.number(),
  })
    .index("by_connection", ["connectionId"])
    .index("by_organization", ["organizationId"]),

  // One Dropbox file being brought in, or brought in: the toolkit streams it from Dropbox
  // straight into the team's folder, then it becomes an upload like any other.
  dropboxImports: defineTable({
    organizationId: v.string(),
    connectionId: v.id("dropboxConnections"),
    // Dropbox's id for the file ("id:..."), which stays the same when it is moved.
    fileId: v.string(),
    path: v.string(),
    name: v.string(),
    // Dropbox's hash of the file's contents: the same file in two watched folders, or
    // watched by two members, comes in once.
    contentHash: v.string(),
    size: v.number(),
    modifiedAt: v.number(),
    status: v.union(
      v.literal("importing"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("duplicate"),
    ),
    uploadId: v.optional(v.id("uploads")),
    jobId: v.optional(v.id("jobs")),
    error: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_file", ["organizationId", "fileId"])
    .index("by_hash", ["organizationId", "contentHash"]),

  // One finished file being sent to Dropbox, or sent, for an automation switched to send
  // its files there. Big files go in pieces, `offset` bytes so far.
  dropboxSends: defineTable({
    organizationId: v.string(),
    connectionId: v.id("dropboxConnections"),
    runId: v.id("runs"),
    automationName: v.string(),
    // The file in the team's folder.
    key: v.string(),
    name: v.string(),
    size: v.number(),
    // The Dropbox folder it goes to, and where it landed once sent.
    folder: v.string(),
    // True when nobody picked a folder: it goes in the member's own folder, not the top
    // of a team space, where members often cannot add folders.
    home: v.optional(v.boolean()),
    dropboxPath: v.optional(v.string()),
    status: v.union(v.literal("sending"), v.literal("done"), v.literal("failed")),
    sessionId: v.optional(v.string()),
    offset: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_run", ["runId"]),

  // The toSend account this dashboard sends email through: failed-run alerts, sign-in
  // emails and team invitations. One for the whole deployment, set once in Settings by
  // the team named here. TOSEND_API_KEY and EMAIL_FROM on the deployment win over it.
  emailConnections: defineTable({
    organizationId: v.string(),
    // AES-GCM ciphertext of the toSend API key.
    apiKeyCipher: v.string(),
    apiKeyHint: v.string(),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    createdBy: v.string(),
    status: v.union(v.literal("ok"), v.literal("failing")),
    // Why the last email could not be sent, in plain words.
    lastError: v.union(v.null(), v.string()),
  }),

  // A member who has switched off emails about failed runs for a team. No row means
  // they get them.
  // Each alert message a chat app was sent, so that once an approval is decided (from the
  // dashboard or any app) every message about it can be changed to say so and lose its
  // buttons. `userId` is left out for a message to a team channel rather than a person.
  chatAlertMessages: defineTable({
    organizationId: v.string(),
    alertId: v.id("alerts"),
    // The approval step it asks about, kept because the alert itself goes once decided.
    runStepId: v.optional(v.id("runSteps")),
    app: chatAppValidator,
    userId: v.optional(v.string()),
    // Whatever the app needs to find the message again, such as "chat id:message id".
    ref: v.string(),
    // The text it was sent with, so it can be edited without building it again.
    text: v.string(),
    settledAt: v.optional(v.number()),
  })
    .index("by_alert", ["alertId"])
    .index("by_runStep", ["runStepId"]),

  notificationPreferences: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    // Per kind of news: under the bell, by email, and in each chat app the member linked.
    // Anything left out keeps its default (see NOTIFICATION_KINDS in
    // convex/lib/notifications.ts).
    kinds: v.optional(
      v.object({
        run_failed: v.optional(kindChannels),
        approval_waiting: v.optional(kindChannels),
        approval_timed_out: v.optional(kindChannels),
        mention: v.optional(kindChannels),
        client_feedback: v.optional(kindChannels),
        ready_for_review: v.optional(kindChannels),
        clip_finished: v.optional(kindChannels),
      }),
    ),
    // "now": each email as it happens. "daily": one summary a day at `digestHour` in
    // `timeZone`; approvals waiting still go at once. Left out: "now".
    emailTiming: v.optional(v.union(v.literal("now"), v.literal("daily"))),
    digestHour: v.optional(v.number()),
    // An IANA zone such as "America/Los_Angeles", from the member's browser.
    timeZone: v.optional(v.string()),
    // When the last daily summary covered up to.
    lastDigestAt: v.optional(v.number()),
  })
    .index("by_organization_and_user", ["organizationId", "userId"])
    .index("by_emailTiming", ["emailTiming"]),

  // A person who has been through a guided tour of the dashboard, finished or closed, so
  // it does not start by itself again. Per person, not per team: the dashboard is the same
  // on every team. No row means they have not.
  tourEnds: defineTable({
    userId: v.string(),
    tourId: tourIdValidator,
    how: v.union(v.literal("finished"), v.literal("closed")),
    endedAt: v.number(),
  }).index("by_user_and_tour", ["userId", "tourId"]),

  // What the toolkit read from a file that reached the bucket without going through this
  // app (dropped in by another tool, or made by a step). Uploads keep theirs on the upload.
  bucketFiles: defineTable({
    organizationId: v.string(),
    key: v.string(),
    // The contents these details were read from. A file replaced under the same name is
    // read again.
    etag: v.string(),
    // Missing while the read is under way, or when the toolkit could not read the file.
    details: v.optional(fileDetailsValidator),
    askedAt: v.number(),
  }).index("by_organization_and_key", ["organizationId", "key"]),

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
    // Where the file came from, when it was not the browser: a meeting recording brought
    // in from a connected Zoom or Google account.
    source: v.optional(
      v.union(
        v.literal("zoom"),
        v.literal("google_meet"),
        v.literal("microsoft"),
        v.literal("dropbox"),
      ),
    ),
    // Who shared a meeting recording brought in from someone else's Drive.
    sharedBy: v.optional(v.string()),
    // Read from the file by the toolkit once the upload finishes. Missing while that is
    // still to happen, or when the toolkit could not read the file.
    details: v.optional(fileDetailsValidator),
    // The bucket's id for a file being sent in parts (a big file), until they are joined.
    partsUploadId: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    // Finds the upload behind a file in the bucket, for the Files page.
    .index("by_organization_and_key", ["organizationId", "key"])
    // Finds an upload of the very same file, so a meeting recording is not brought in twice.
    .index("by_organization_and_size", ["organizationId", "size"]),

  // A review room: a set of clips a team looks at together, comments on, and approves.
  // Opened by hand from Outputs, or by an approval step when a run reaches it.
  reviews: defineTable({
    organizationId: v.string(),
    title: v.string(),
    status: v.union(v.literal("open"), v.literal("approved"), v.literal("rejected")),
    // Set when an approval step opened the room. Deciding the room decides that step.
    runId: v.optional(v.id("runs")),
    runStepId: v.optional(v.id("runSteps")),
    // The person who opened it; null when a run did.
    createdBy: v.union(v.null(), v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    // What the client said through the review's share link. It tells the team; only a
    // teammate's decision approves the review or lets a paused run carry on.
    clientVerdict: v.optional(
      v.object({ name: v.string(), approved: v.boolean(), at: v.number() }),
    ),
  })
    .index("by_organization", ["organizationId"])
    .index("by_runStep", ["runStepId"]),

  // A link that lets someone outside the team, such as a client, open one review without
  // an account: watch the clips, comment, and say whether they approve. At most one per
  // review; switching it off deletes it, so the old link stops working for good.
  reviewShares: defineTable({
    reviewId: v.id("reviews"),
    organizationId: v.string(),
    // The secret in the link (/share/<token>).
    token: v.string(),
    createdBy: v.string(),
    // Whether the client may approve or ask for changes.
    allowVerdict: v.boolean(),
    // Whether the client sees the team's own threads too, or only their own.
    showTeamComments: v.boolean(),
  })
    .index("by_token", ["token"])
    .index("by_review", ["reviewId"]),

  // A client's portal: one link where the client sees only their own projects, in the
  // team's logo and colours, and opens each project's review room. At most one per client;
  // switching it off deletes it, so the old link stops working for good.
  clientPortals: defineTable({
    clientId: v.id("clients"),
    organizationId: v.string(),
    // The secret in the link (/portal/<token>).
    token: v.string(),
    createdBy: v.string(),
    // Passed on to each review room the client opens from the portal.
    allowVerdict: v.boolean(),
    showTeamComments: v.boolean(),
  })
    .index("by_token", ["token"])
    .index("by_client", ["clientId"]),

  // One clip in a review. A changed clip is added as a new version, so comments on the
  // earlier ones stay where they were made.
  reviewClips: defineTable({
    reviewId: v.id("reviews"),
    organizationId: v.string(),
    title: v.string(),
    versions: v.array(
      v.object({
        url: v.string(),
        // The person who added it; null when a run did.
        addedBy: v.union(v.null(), v.string()),
        addedAt: v.number(),
      }),
    ),
  }).index("by_review", ["reviewId"]),

  // A comment on a clip, pinned to a moment in it. A reply points at the comment that
  // started its thread and carries that comment's moment.
  reviewComments: defineTable({
    reviewId: v.id("reviews"),
    clipId: v.id("reviewClips"),
    organizationId: v.string(),
    // Which version of the clip was on screen, counted from 1.
    version: v.number(),
    // Seconds into the clip.
    time: v.number(),
    body: v.string(),
    authorId: v.string(),
    // The author's name when they wrote it, so the comment still reads after they leave.
    authorName: v.string(),
    parentId: v.optional(v.id("reviewComments")),
    resolved: v.boolean(),
    // Written through the review's share link by someone outside the team. Their
    // authorId is "guest:" and a random id their browser keeps.
    client: v.optional(v.boolean()),
    // Written by a teammate as a reply in the team's Slack thread for this comment.
    slack: v.optional(v.boolean()),
    // Marks drawn over the paused frame, on a thread's first comment only.
    drawing: v.optional(drawingValidator),
    // Set on the agent's answer to an "@Agent" comment. The answer is written by the
    // agent server through Convex itself, never by the person who asked.
    agent: v.optional(
      v.object({
        // Who asked: their name is shown beside the answer, and only they can ask again.
        askedBy: v.string(),
        state: v.union(v.literal("thinking"), v.literal("answered"), v.literal("failed")),
      }),
    ),
  })
    .index("by_clip", ["clipId"])
    .index("by_review", ["reviewId"]),

  // A client an agency works for, inside one team. Its brand fills in before the team's
  // for the automations that are for it, and its finished files are kept in its own folder.
  clients: defineTable({
    organizationId: v.string(),
    name: v.string(),
    // Only what the client sets; anything left out comes from the team's brand.
    brand: v.optional(brandValidator),
    // The client's own music. Left out, its automations use the team's.
    music: v.optional(musicValidator),
    // Where its finished files go, inside the team's folder. Left out: Clients/<name>/.
    deliveryFolder: v.optional(v.string()),
    createdBy: v.string(),
  }).index("by_organization", ["organizationId"]),

  // A project: one piece of work, such as an episode, with a slot for each thing to
  // deliver. A package picked when it was made decides the slots it starts with.
  projects: defineTable({
    organizationId: v.string(),
    clientId: v.optional(v.id("clients")),
    name: v.string(),
    // The package it started from, such as "video_podcast".
    package: v.string(),
    // The review room its slots go to when a version is added. Opened the first time.
    reviewId: v.optional(v.id("reviews")),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_client", ["clientId"])
    .index("by_review", ["reviewId"]),

  // One thing a project delivers, such as "Short 3" or "Episode thumbnail". It starts
  // empty; each file put in it is a new version, which goes to the project's review room.
  deliverables: defineTable({
    projectId: v.id("projects"),
    organizationId: v.string(),
    kind: deliverableKindValidator,
    label: v.string(),
    // Its place in the project's list.
    order: v.number(),
    status: deliverableStatusValidator,
    versions: v.array(
      v.object({
        url: v.string(),
        // The person who added it; null when a run did.
        addedBy: v.union(v.null(), v.string()),
        addedAt: v.number(),
      }),
    ),
    // Its clip in the project's review room, once it has a version.
    clipId: v.optional(v.id("reviewClips")),
    // When it is due, set on the content calendar. Left out: no due date yet.
    dueAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_organization_and_dueAt", ["organizationId", "dueAt"])
    .index("by_clip", ["clipId"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  // A post planned on the content calendar: what goes out, where, and when. With no time
  // it waits in the calendar's side list; queued ones fill the team's repeating slots.
  // Nothing is posted for the team yet, so "posted" is set by hand.
  calendarPosts: defineTable({
    organizationId: v.string(),
    title: v.string(),
    // A posting app id from automation-core's CALENDAR_PLATFORMS, such as "instagram".
    platform: v.string(),
    // When it goes out. Null: not scheduled.
    at: v.union(v.null(), v.number()),
    // Waiting for the next free slot for its platform. Queue order is queuedAt.
    queued: v.boolean(),
    queuedAt: v.number(),
    // The repeating slot that placed it, while it keeps that slot's time.
    slotId: v.optional(v.id("calendarSlots")),
    status: v.union(v.literal("planned"), v.literal("posted")),
    // The file it posts, from the library.
    libraryItemId: v.optional(v.id("libraryItems")),
    clientId: v.optional(v.id("clients")),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_organization_and_at", ["organizationId", "at"])
    .index("by_slot", ["slotId"])
    .index("by_libraryItem", ["libraryItemId"])
    .index("by_client", ["clientId"]),

  // A repeating time on the calendar, such as "Mondays at 10:00 for Instagram". Queued
  // posts for its platform fill its next free times.
  calendarSlots: defineTable({
    organizationId: v.string(),
    weekday: v.number(),
    time: v.string(),
    timeZone: v.string(),
    platform: v.string(),
    // Kept for one client's posts. Left out: anyone's.
    clientId: v.optional(v.id("clients")),
    createdBy: v.string(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_client", ["clientId"]),

  // The content library: one row per file the team has, whether someone uploaded it or an
  // automation made it. Gives each file a short ID ("V12", "C99") people and the agent can
  // name it by, remembers where it came from, and holds its tags and stars.
  libraryItems: defineTable({
    organizationId: v.string(),
    // "V12": a letter for the kind of file (see shortIdLetter) and the team's next number
    // for that letter. Never reused, even after the file is removed.
    shortId: v.string(),
    kind: libraryKindValidator,
    source: v.union(v.literal("upload"), v.literal("automation")),
    title: v.string(),
    // Where the file is: its key inside the team's folder of the bucket when it is there,
    // or else the address the toolkit gave it.
    key: v.optional(v.string()),
    url: v.optional(v.string()),
    // The upload it is, for an uploaded file.
    uploadId: v.optional(v.id("uploads")),
    // For a file an automation made: the run, and the automation's name at the time.
    runId: v.optional(v.id("runs")),
    automationName: v.optional(v.string()),
    // The file it was made from, such as the episode a clip was cut from.
    parentId: v.optional(v.id("libraryItems")),
    // The client it is for: copied from the run that made it (or the file it was made
    // from), or set by hand. Left out for the team's own files.
    clientId: v.optional(v.id("clients")),
    details: v.optional(fileDetailsValidator),
    tags: v.array(v.string()),
    // One to five stars, given once a file has been out in the world, so winners are easy
    // to find again.
    rating: v.optional(v.number()),
    // The ID, title, tags and automation on one line, for search (librarySearchText).
    searchText: v.string(),
    // Whether what was said in it can be searched yet. The words are in transcriptPieces.
    transcript: v.optional(
      v.object({
        status: v.union(v.literal("working"), v.literal("ready"), v.literal("failed")),
        jobId: v.optional(v.id("jobs")),
        error: v.optional(v.string()),
        language: v.optional(v.string()),
        at: v.number(),
      }),
    ),
    // Whether the picture model has looked at it, so it can be found by what it shows.
    // The frames are in libraryFrames.
    look: v.optional(
      v.object({
        status: v.union(v.literal("working"), v.literal("ready"), v.literal("failed")),
        jobId: v.optional(v.id("jobs")),
        error: v.optional(v.string()),
        // Short, small faces, little said: it looks like B-Roll (broll.ts looksLikeBroll).
        brollLike: v.optional(v.boolean()),
        at: v.number(),
      }),
    ),
    // Set by a person: use it as B-Roll ("yes") or never ("no"), whatever it looks like.
    broll: v.optional(v.union(v.literal("yes"), v.literal("no"))),
    // Who brought it in; null for a file an automation made.
    createdBy: v.union(v.null(), v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_shortId", ["organizationId", "shortId"])
    .index("by_organization_and_key", ["organizationId", "key"])
    .index("by_organization_and_url", ["organizationId", "url"])
    .index("by_upload", ["uploadId"])
    .index("by_parent", ["parentId"])
    .index("by_run", ["runId"])
    .index("by_client", ["clientId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["organizationId"] }),

  // What was said in a library file, in pieces of about thirty seconds, so a search lands
  // on the moment ("where did I talk about pricing?").
  transcriptPieces: defineTable({
    organizationId: v.string(),
    itemId: v.id("libraryItems"),
    start: v.number(),
    end: v.number(),
    text: v.string(),
  })
    .index("by_item_and_start", ["itemId", "start"])
    .searchIndex("search_speech", { searchField: "text", filterFields: ["organizationId"] }),

  // Frames of a library video (or the one picture), as the picture model sees them, so
  // footage can be found by what it shows. `vector` is CLIP ViT-B/32, length 1.
  libraryFrames: defineTable({
    organizationId: v.string(),
    itemId: v.id("libraryItems"),
    time: v.number(),
    // How much of the frame the largest face covers, 0 to 1.
    face: v.number(),
    vector: v.array(v.float64()),
  })
    .index("by_item", ["itemId"])
    .vectorIndex("by_vector", {
      vectorField: "vector",
      dimensions: 512,
      filterFields: ["organizationId"],
    }),

  // Stock searches kept for a day, as Pixabay asks, so the same words are not asked again.
  stockSearches: defineTable({
    site: v.union(v.literal("pixabay"), v.literal("pexels")),
    query: v.string(),
    hits: v.array(
      v.object({
        id: v.string(),
        url: v.string(),
        thumbnail: v.string(),
        page: v.string(),
        by: v.string(),
        title: v.string(),
        duration: v.number(),
        width: v.number(),
        height: v.number(),
      }),
    ),
    at: v.number(),
  }).index("by_site_and_query", ["site", "query"]),

  // A team's stock footage keys, for a dashboard that has none built in. Encrypted.
  stockKeys: defineTable({
    organizationId: v.string(),
    pixabay: v.optional(v.string()),
    pexels: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  // The next number for each short ID letter, per team.
  libraryCounters: defineTable({
    organizationId: v.string(),
    letter: v.string(),
    next: v.number(),
  }).index("by_organization_and_letter", ["organizationId", "letter"]),

  // A team's free trial on the hosted edition: made when the team is made, while trials
  // are on (TRIAL_DAYS, 3 unless set). A team without a row has no trial and no limit.
  teamTrials: defineTable({
    organizationId: v.string(),
    startedAt: v.number(),
    endsAt: v.number(),
    // Set by the operator once the team has bought: the trial no longer ends anything.
    paidAt: v.optional(v.number()),
    // Who made the team, their mailbox however it was written (lib/emailKey.ts), and a
    // keyed hash of the network they signed up from (lib/clientIp.ts). Used to find a
    // person's earlier trial, so a new email or a new team doesn't give fresh days.
    ownerId: v.optional(v.string()),
    emailKey: v.optional(v.string()),
    networkKey: v.optional(v.string()),
    // Set when this team got no fresh days because its owner, or their network, had a
    // trial already.
    repeatOf: v.optional(v.union(v.literal("email"), v.literal("network"))),
  })
    .index("by_organization", ["organizationId"])
    .index("by_email_key", ["emailKey"])
    .index("by_network_and_started", ["networkKey", "startedAt"]),

  // Where each person signed up from, on the hosted edition: their mailbox however it was
  // written and a keyed hash of their network, never the address itself.
  signUps: defineTable({
    userId: v.string(),
    emailKey: v.string(),
    networkKey: v.string(),
    at: v.number(),
  }).index("by_user", ["userId"]),

  // Teams and people the operator has blocked (blocks.ts). A blocked team keeps all it
  // made but starts nothing new; a blocked person can't sign in at all.
  blocks: defineTable({
    kind: v.union(v.literal("team"), v.literal("user")),
    targetId: v.string(),
    reason: v.optional(v.string()),
    blockedAt: v.number(),
  }).index("by_kind_and_target", ["kind", "targetId"]),

  // Per-team library settings. A team without a row has the defaults.
  librarySettings: defineTable({
    organizationId: v.string(),
    // Transcribe each new video and sound on the team's own toolkit, so it can be searched.
    searchNewFiles: v.boolean(),
    // When the files a team had before the library were added to it.
    filledAt: v.optional(v.number()),
  }).index("by_organization", ["organizationId"]),
});
