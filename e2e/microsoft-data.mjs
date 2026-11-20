// What the Microsoft stand-in (e2e/microsoft-stand-in.mjs) and the browser tests agree on:
// the account and the recordings in its OneDrive. Plain data, so a test can import it
// without starting anything.

export const MICROSOFT_PORT = 8772;
export const MICROSOFT = `http://127.0.0.1:${MICROSOFT_PORT}`;
export const MICROSOFT_USER = {
  id: "ms-user-stand-in",
  displayName: "Harbour Organizer",
  mail: "organizer@harbour.test",
  userPrincipalName: "organizer@harbour.onmicrosoft.test",
  // The Microsoft organization (Entra tenant) the account belongs to.
  tid: "00000000-0000-4000-8000-0000000000aa",
};

/** A Microsoft Teams team the dashboard's bot is in, and where Teams says to post. */
export const TEAMS_TEAM = {
  id: "19:harbour-general@thread.tacv2",
  name: "Harbour Video",
  serviceUrl: `${MICROSOFT}/bot`,
};

/** A recording Teams saved to the Recordings folder, the way OneDrive lists it. */
export function recording(id, topic, minutesAgo) {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    name: `${topic}-20261117_170000-Meeting Recording.mp4`,
    size: 48_000_000,
    createdDateTime: at,
    lastModifiedDateTime: at,
    file: { mimeType: "video/mp4" },
    video: { duration: 37 * 60_000 },
  };
}
