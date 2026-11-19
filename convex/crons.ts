import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Starts every scheduled automation that has come due.
crons.interval("start due automations", { minutes: 1 }, internal.automations.tick, {});

// Looks in every watched folder for files that have arrived.
crons.interval("check watched folders", { minutes: 1 }, internal.watch.poll, {});

// Asks the toolkit about running jobs whose result is late, in case its webhook was lost.
crons.interval("check on late toolkit jobs", { minutes: 1 }, internal.jobs.checkLate, {});

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

// Forgets saved Best moments and Chapters answers more than 30 days old.
crons.daily(
  "forget old pick answers",
  { hourUTC: 9, minuteUTC: 30 },
  internal.moments.forgetOldAnswers,
  {},
);

export default crons;
