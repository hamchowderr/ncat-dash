import { defineSchema } from "convex/server";
import { tables } from "./generatedSchema";

// generatedSchema.ts is written by the Better Auth CLI:
//   cd convex/betterAuth && npx auth@1.7 generate --output generatedSchema.ts
// Custom indexes live here so regenerating never overwrites them.
const schema = defineSchema({
  ...tables,
  member: tables.member.index("userId_organizationId", ["userId", "organizationId"]),
});

export default schema;
