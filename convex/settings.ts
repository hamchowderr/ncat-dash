import { components } from "./_generated/api";
import { requireEmailVerification, socialProviders } from "./lib/signInOptions";
import { emailConfigured } from "./email";
import { query } from "./_generated/server";
import { getEdition } from "./lib/edition";
import { BETA_FORM_URL, signUpsMode } from "./lib/signUps";
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
    // How people can sign in, for the sign-in screens: Google once its keys are set, a
    // password reset once email can be sent, and whether an address must be confirmed.
    return {
      edition: getEdition(),
      trialDays: trialDays(),
      inviteOnly,
      // On the hosted Takewon, invite-only means a closed beta: strangers ask on the website.
      betaFormUrl: inviteOnly && getEdition() === "hosted" ? BETA_FORM_URL : null,
      signInWith: { google: "google" in socialProviders() },
      emailConfigured: await emailConfigured(ctx),
      emailVerification: requireEmailVerification(),
    };
  },
});
