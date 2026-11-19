// What the Google stand-in (e2e/google-meet-stand-in.mjs) and the browser tests agree on:
// the account and its Meet recordings. Plain data, so a test can import it without
// starting anything.

export const GOOGLE_PORT = 8771;
export const GOOGLE = `http://127.0.0.1:${GOOGLE_PORT}`;
export const GOOGLE_USER = {
  sub: "google-user-stand-in",
  email: "host@harbour.test",
  name: "Harbour Host",
};

/**
 * One meeting that took place, its recording as Meet lists it, and the file Meet saved to
 * Drive (whose name carries the meeting's title).
 */
export function meeting(id = "past-meeting-1", title = "Client Kickoff", endedAgoMs = 2 * 864e5) {
  const end = Date.now() - endedAgoMs;
  const start = end - 37 * 60 * 1000;
  const file = `driveFile${id.replace(/[^A-Za-z0-9]/g, "")}0001`;
  return {
    conference: {
      name: `conferenceRecords/${id}`,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
    },
    recording: {
      name: `conferenceRecords/${id}/recordings/rec-${id}`,
      state: "FILE_GENERATED",
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      driveDestination: { file, exportUri: `https://drive.google.com/file/d/${file}/view` },
    },
    file: {
      id: file,
      name: `${title} (${new Date(start).toISOString().slice(0, 10)} 10:02 GMT-8) - Recording`,
      // Each recording its own size: the dashboard takes the same size for the same file.
      size: String(
        48_000_000 + ([...id].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) % 999_983),
      ),
      mimeType: "video/mp4",
      createdTime: new Date(end).toISOString(),
      videoMediaMetadata: { durationMillis: String(37 * 60 * 1000) },
    },
  };
}

/**
 * A recording from long ago that only Drive still has: Meet forgets meetings after 30 days,
 * so it is not among the meetings, only among the files.
 */
export function oldRecording() {
  const saved = Date.now() - 400 * 864e5;
  return {
    id: "driveFileAnnualReview0001",
    name: "Annual Review - 2025/10/14 15:00 PDT - Recording",
    size: "61000000",
    mimeType: "video/mp4",
    createdTime: new Date(saved).toISOString(),
    videoMediaMetadata: { durationMillis: String(52 * 60 * 1000) },
  };
}

/** A recording of someone else's meeting, in their Drive, shared with the signed-in person. */
export function sharedRecording() {
  const saved = Date.now() - 30 * 864e5;
  return {
    id: "driveFileSharedCall0001",
    name: "Partner Sync (2026-10-20 09:00 GMT-7) - Recording",
    size: "23000000",
    mimeType: "video/mp4",
    createdTime: new Date(saved).toISOString(),
    videoMediaMetadata: { durationMillis: String(21 * 60 * 1000) },
    owners: [{ displayName: "Pat Rivera", emailAddress: "pat@partner.test", me: false }],
  };
}
