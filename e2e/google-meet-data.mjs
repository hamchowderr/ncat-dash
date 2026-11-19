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
      size: "48000000",
      mimeType: "video/mp4",
    },
  };
}
