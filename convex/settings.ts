import { query } from "./_generated/server";
import { getEdition } from "./lib/edition";

/** Deployment-wide settings the interface needs before anyone signs in. Nothing secret. */
export const get = query({
  args: {},
  handler: async () => {
    return { edition: getEdition() };
  },
});
