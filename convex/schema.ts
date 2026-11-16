import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

  // One run of one toolkit step. Phase 2 runs them from the test bench; automations
  // will create them per step later.
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
  })
    .index("by_organization", ["organizationId"])
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
