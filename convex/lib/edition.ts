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
