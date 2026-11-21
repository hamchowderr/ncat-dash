// Lets the Kontifi desktop app (apps/desktop) tell a Kontifi from any other site when
// someone types an address. Public on purpose: it says only that this is a Kontifi.
export function GET() {
  return Response.json({ app: "kontifi" });
}
