// Lets the desktop app (apps/desktop) tell this dashboard from any other site when
// someone types an address. Public on purpose: it says only which app this is.
// It still answers with the name from before the rename to Takewon: desktop apps
// released before the rename accept only that, and newer ones accept "takewon" too.
// Switch it once installed apps have updated.
export function GET() {
  return Response.json({ app: "ncat-dash" });
}
