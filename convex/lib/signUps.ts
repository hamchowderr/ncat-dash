export const INVITE_ONLY_MESSAGE =
  "This dashboard is invite-only. Ask someone on a team here to invite this email address.";

/** The website's beta page: what the beta is, what happens after applying, and the form to ask for an invite. */
export const BETA_FORM_URL = "https://takewon.com/beta";

/**
 * What a stranger is told on the hosted Takewon when sign-ups are invite-only: it is a
 * closed beta, so they ask on the website first and get an invite by email.
 */
export const CLOSED_BETA_MESSAGE =
  "Takewon is in a closed beta. Join the beta at takewon.com/beta and you'll get an invite by email.";

/**
 * Who may make an account, set with SIGN_UPS:
 * - `invite-only`: the first person (the owner), then only addresses invited to a team.
 * - `open`: anyone who can reach the dashboard. The default, on both editions; the
 *   self-hosting guide has owners set invite-only.
 */
export function signUpsMode(
  env: Record<string, string | undefined> = process.env,
): "open" | "invite-only" {
  const asked = env.SIGN_UPS?.trim().toLowerCase();
  return asked === "invite-only" ? "invite-only" : "open";
}
