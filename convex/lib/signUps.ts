export const INVITE_ONLY_MESSAGE =
  "This dashboard is invite-only. Ask someone on a team here to invite this email address.";

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
