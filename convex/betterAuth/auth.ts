import { createAuth } from "../auth";

// Static instance for Better Auth schema generation only (`npx auth@1.7 generate`).
// Never import this file at runtime: it runs without environment variables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth = createAuth({} as any);
