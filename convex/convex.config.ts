import { defineApp } from "convex/server";
import presence from "@convex-dev/presence/convex.config.js";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
app.use(betterAuth);
// Who is in a review room right now.
app.use(presence);

export default app;
