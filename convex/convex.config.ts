import { defineApp } from "convex/server";
import presence from "@convex-dev/presence/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import supportTickets from "convex-support-tickets/convex.config.js";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
app.use(betterAuth);
// Who is in a review room right now.
app.use(presence);
// How often sign-ups, new teams, agent replies and MCP calls may happen (lib/limits.ts).
app.use(rateLimiter);
// Background work, a few at a time, with retries (lib/pools.ts).
// Customers' support tickets and the replies to them (support.ts).
app.use(supportTickets);
app.use(workpool, { name: "outboundPool" });
app.use(workpool, { name: "toolkitPool" });
app.use(workpool, { name: "backgroundPool" });
app.use(workpool, { name: "chatPool" });

export default app;
