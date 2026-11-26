import { after } from "next/server";

import { emitPostHogLog, flushPostHogLogs } from "@/instrumentation";

// Lets the desktop app (apps/desktop) tell this dashboard from any other site when
// someone types an address. Public on purpose: it says only which app this is.
// Desktop apps from before the rename to Takewon expected "ncat-dash"; they update
// themselves to a version that accepts "takewon" too.
export function GET() {
  emitPostHogLog("Desktop app identity requested", {
    endpoint: "/api/desktop",
    method: "GET",
  });
  after(() => flushPostHogLogs());

  return Response.json({ app: "takewon" });
}
