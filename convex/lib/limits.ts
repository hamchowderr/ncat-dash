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
 * - MCP calls: per key or sign-in, for AI clients that loop.
 */
export const limiter = new RateLimiter(components.rateLimiter, {
  signUpFromNetwork: { kind: "fixed window", rate: 5, period: HOUR },
  signUpFromUnknown: { kind: "fixed window", rate: 10, period: HOUR },
  signUps: { kind: "token bucket", rate: 100, period: HOUR, capacity: 30 },
  newTeam: { kind: "fixed window", rate: 3, period: DAY },
  agentTurnPerson: { kind: "token bucket", rate: 60, period: HOUR, capacity: 15 },
  agentTurnTeam: { kind: "token bucket", rate: 240, period: HOUR, capacity: 40 },
  mcpCall: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 60 },
});

/** "in about 3 minutes", "in about an hour", for a wait in milliseconds. */
export function waitLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes < 60) return `in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "in about an hour" : `in about ${hours} hours`;
}
