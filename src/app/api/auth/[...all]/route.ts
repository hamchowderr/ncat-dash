import { handler } from "@/lib/auth-server";
import { withClientIp } from "@/lib/client-ip";

// Auth requests go through this app's own address and are passed on to Convex,
// so sign-in cookies belong to the dashboard's domain. Each carries the visitor's
// address, signed, for the sign-up limits (convex/lib/clientIp.ts).
export const GET = (request: Request) => handler.GET(withClientIp(request));
export const POST = (request: Request) => handler.POST(withClientIp(request));
