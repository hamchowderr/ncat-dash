import { handler } from "@/lib/auth-server";

// Auth requests go through this app's own address and are passed on to Convex,
// so sign-in cookies belong to the dashboard's domain.
export const { GET, POST } = handler;
