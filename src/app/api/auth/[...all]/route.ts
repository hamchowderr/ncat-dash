import { asBrowserRedirect } from "@/lib/auth-redirect";
import { handler } from "@/lib/auth-server";
import { withClientIp } from "@/lib/client-ip";

// Auth requests go through this app's own address and are passed on to Convex,
// so sign-in cookies belong to the dashboard's domain. Each carries the visitor's
// address, signed, for the sign-up limits (convex/lib/clientIp.ts). A browser opening
// an auth link is sent on with a real redirect (src/lib/auth-redirect.ts).
export const GET = async (request: Request) =>
  asBrowserRedirect(request, await handler.GET(withClientIp(request)));
export const POST = (request: Request) => handler.POST(withClientIp(request));
