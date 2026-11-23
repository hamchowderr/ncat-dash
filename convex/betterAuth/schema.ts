import { defineSchema } from "convex/server";
import { tables } from "./generatedSchema";

// generatedSchema.ts is written by the Better Auth CLI:
//   cd convex/betterAuth && npx auth@1.7 generate --output generatedSchema.ts
// Custom indexes live here so regenerating never overwrites them.
const schema = defineSchema({
  ...tables,
  member: tables.member
    .index("userId_organizationId", ["userId", "organizationId"])
    .index("organizationId_userId", ["organizationId", "userId"]),
  // The agents connected to a team (Settings > MCP), by the team each consent is for.
  oauthConsent: tables.oauthConsent.index("referenceId", ["referenceId"]),
});

export default schema;
