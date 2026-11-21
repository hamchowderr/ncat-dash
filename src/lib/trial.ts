/** What the agent says instead of answering once a team's free trial is over. */
export const TRIAL_ENDED_REPLY =
  "Your free trial has ended, so the agent is resting. Everything you made is kept and the agent is back once you have Takewon.";

/** "3 days left in your trial", "1 day left in your trial", "Last day of your trial". */
export function daysLeftLabel(days: number): string {
  if (days <= 0) return "Last day of your trial";
  return `${days} ${days === 1 ? "day" : "days"} left in your trial`;
}
