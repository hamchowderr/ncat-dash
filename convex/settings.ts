import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { getEdition } from "./lib/edition";
import { signUpsMode } from "./lib/signUps";
import { trialDays } from "./lib/trial";

/** Deployment-wide settings the interface needs before anyone signs in. Nothing secret. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    // trialDays: how long a new team's free trial lasts, or null when there is none.
    // inviteOnly: new accounts need an invitation (SIGN_UPS=invite-only, once the owner
    // has one), so the sign-up page can say so before anyone types.
    const inviteOnly =
      signUpsMode() === "invite-only" &&
      (await ctx.runQuery(components.betterAuth.members.signUpCheck, { email: "" })).hasAccounts;
    return { edition: getEdition(), trialDays: trialDays(), inviteOnly };
  },
});
