import { createApi } from "@convex-dev/better-auth";
import type { BetterAuthOptions } from "better-auth";
import { pluginTables } from "./pluginTables";
import schema from "./schema";

// createApi only reads the options to learn the tables and their unique fields, so it
// gets the plugins' table list rather than createAuthOptions from ../auth. That file
// loads all of Better Auth, which this adapter would otherwise pay for on every call.
export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
  consumeOne,
  incrementOne,
} = createApi(schema, () => ({ plugins: pluginTables }) as unknown as BetterAuthOptions);
