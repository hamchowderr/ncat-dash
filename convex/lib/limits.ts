import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";

import { components } from "../_generated/api";

/**
 * How often things that cost money or invite abuse may happen. Generous enough that a
 * real person never meets them; they stop scripts and runaway loops.
 *
 * - Sign-ups (hosted edition only): five an hour from one network, ten an hour shared by
 *   everyone whose network is unknown, and a ceiling for all sign-ups together.
 * - New teams: three a day per person, so one account can't mint free trials.
 * - Agent replies: per person and per team, in the dashboard, Slack and Discord alike,
 *   since every reply spends AI tokens.
 * - MCP calls: per sign-in, for AI clients that loop.
 * - Password sign-ins (every edition): per network and per account, so nobody can guess
 *   passwords quickly. The account's allowance is the larger one, so someone guessing
 *   from elsewhere slows the account down without locking its owner out for long.
 * - Help requests and messages on them: per person, since each one emails support.
 * - Emails sent on request (password resets, confirmation links): per address and per
 *   network, so the dashboard can't be used to flood someone's inbox.
 * - Product news sign-ups from the website: a couple a day per address, so the box can't
 *   be used to flood someone with confirmation emails, and a ceiling for all of them.
 */
export const limiter = new RateLimiter(components.rateLimiter, {
  signUpFromNetwork: { kind: "fixed window", rate: 5, period: HOUR },
  signUpFromUnknown: { kind: "fixed window", rate: 10, period: HOUR },
  signUps: { kind: "token bucket", rate: 100, period: HOUR, capacity: 30 },
  newTeam: { kind: "fixed window", rate: 3, period: DAY },
  agentTurnPerson: { kind: "token bucket", rate: 60, period: HOUR, capacity: 15 },
  agentTurnTeam: { kind: "token bucket", rate: 240, period: HOUR, capacity: 40 },
  mcpCall: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 60 },
  signInFromNetwork: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
  signInFromUnknown: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  signInToAccount: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
  authEmailToAddress: { kind: "token bucket", rate: 5, period: HOUR, capacity: 3 },
  authEmailFromNetwork: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },
  // Help requests and messages on them, per person: each one emails support.
  supportMessage: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
  newsSignUpToAddress: { kind: "token bucket", rate: 3, period: DAY, capacity: 2 },
  newsSignUps: { kind: "token bucket", rate: 300, period: HOUR, capacity: 60 },
});

/** "in about 3 minutes", "in about an hour", for a wait in milliseconds. */
export function waitLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes < 60) return `in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "in about an hour" : `in about ${hours} hours`;
}
