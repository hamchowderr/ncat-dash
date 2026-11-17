import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Starts every scheduled automation that has come due.
crons.interval("start due automations", { minutes: 1 }, internal.automations.tick, {});

// Looks in every watched folder for files that have arrived.
crons.interval("check watched folders", { minutes: 1 }, internal.watch.poll, {});

// Sends the daily summary email of each member who chose one, at their own hour.
crons.hourly(
  "send daily notification summaries",
  { minuteUTC: 0 },
  internal.notifications.bookDigests,
  {},
);

export default crons;
