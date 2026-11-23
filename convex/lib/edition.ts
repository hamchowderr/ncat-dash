/**
 * One codebase, two editions.
 * - self-hosted: the owner runs their own copy with their own toolkit and keys. No credits.
 * - hosted: many customers on one deployment, each on their own domain, paying in credits.
 * Set with `npx convex env set NCAT_EDITION hosted`. Defaults to self-hosted.
 */
export type Edition = "self-hosted" | "hosted";

export function getEdition(): Edition {
  return process.env.NCAT_EDITION === "hosted" ? "hosted" : "self-hosted";
}

function origin(address: string): string {
  try {
    return new URL(address).origin.toLowerCase();
  } catch {
    return address.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Whether a team's toolkit is one the operator runs for customers, rather than the team's
 * own: the address in HOSTED_TOOLKIT_URL (`npx convex env set HOSTED_TOOLKIT_URL https://...`).
 * On the hosted edition without that address set, every toolkit counts as the operator's.
 * Such teams do not look after the toolkit, so its server load is not theirs to see. A
 * hosted team that points at its own toolkit looks after that one itself.
 */
export function onOperatorToolkit(baseUrl: string | null | undefined): boolean {
  const ours = process.env.HOSTED_TOOLKIT_URL?.trim();
  if (!ours) return getEdition() === "hosted";
  if (!baseUrl) return false;
  return origin(ours) === origin(baseUrl);
}
