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
});
