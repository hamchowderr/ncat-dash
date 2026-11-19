import { query } from "./_generated/server";
import { getEdition } from "./lib/edition";
import { trialDays } from "./lib/trial";

/** Deployment-wide settings the interface needs before anyone signs in. Nothing secret. */
export const get = query({
  args: {},
  handler: async () => {
    // trialDays: how long a new team's free trial lasts, or null when there is none.
    return { edition: getEdition(), trialDays: trialDays() };
  },
});
