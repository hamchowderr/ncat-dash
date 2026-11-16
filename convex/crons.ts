import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Starts every scheduled automation that has come due.
crons.interval("start due automations", { minutes: 1 }, internal.automations.tick, {});

export default crons;
