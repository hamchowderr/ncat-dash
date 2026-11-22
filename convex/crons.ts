import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Starts every scheduled automation that has come due.
crons.interval("start due automations", { minutes: 1 }, internal.automations.tick, {});

// Looks in every watched folder for files that have arrived.
crons.interval("check watched folders", { minutes: 1 }, internal.watch.poll, {});

// Asks the toolkit about running jobs whose result is late, in case its webhook was lost.
crons.interval("check on late toolkit jobs", { minutes: 1 }, internal.jobs.checkLate, {});

// Reads how many workers the toolkit teams share has, which sets how many of their jobs
// it is sent at once.
crons.interval(
  "check the shared toolkit's workers",
  { minutes: 5 },
  internal.toolkitHealth.checkShared,
  {},
);

// Ends steps that stopped moving, so their runs finish and the team hears about them.
crons.interval("end stuck steps", { minutes: 15 }, internal.stuck.endStuckSteps, {});

// Asks Google Meet for finished recordings of every account that brings them in.
crons.interval("check Google Meet recordings", { minutes: 5 }, internal.googleMeet.checkAll, {});

// Sends the daily summary email of each member who chose one, at their own hour.
crons.hourly(
  "send daily notification summaries",
  { minuteUTC: 0 },
  internal.notifications.bookDigests,
  {},
);

// Renews Microsoft's watches on connected OneDrives, and looks for Teams recordings a
// change notice missed.
crons.interval("check Microsoft 365 recordings", { minutes: 15 }, internal.microsoft.sweep, {});
crons.interval("check watched Dropbox folders", { minutes: 15 }, internal.dropbox.sweep, {});

// Forgets webhook calls' Idempotency-Keys after a day.
crons.daily(
  "forget old webhook keys",
  { hourUTC: 9, minuteUTC: 45 },
  internal.hooks.forgetOldCalls,
  {},
);

// Forgets saved Best moments and Chapters answers more than 30 days old.
crons.daily(
  "forget old pick answers",
  { hourUTC: 9, minuteUTC: 30 },
  internal.moments.forgetOldAnswers,
  {},
);

// Tells each team a week before a creator's deal runs out (Creators).
crons.daily(
  "warn before creator usage rights end",
  { hourUTC: 15, minuteUTC: 0 },
  internal.creators.checkEnding,
  {},
);

export default crons;
