// Lets the desktop app (apps/desktop) tell this dashboard from any other site when
// someone types an address. Public on purpose: it says only which app this is. The
// answer names the codebase, not the product, so a product rename doesn't break it.
export function GET() {
  return Response.json({ app: "ncat-dash" });
}
