import { v } from "convex/values";
import { query } from "./_generated/server";
import { isOperator } from "./lib/operator";

/** Whether the signed-in person runs this copy of Takewon, so the Admin pages show. */
export const me = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await isOperator(ctx),
});
