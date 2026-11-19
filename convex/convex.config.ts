import { defineApp } from "convex/server";
import presence from "@convex-dev/presence/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
app.use(betterAuth);
// Who is in a review room right now.
app.use(presence);
// How often sign-ups, new teams, agent replies and MCP calls may happen (lib/limits.ts).
app.use(rateLimiter);

export default app;
