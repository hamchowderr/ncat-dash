// What the Zoom stand-in (e2e/zoom-stand-in.mjs) and the browser tests agree on: the
// account and its recordings. Plain data, so a test can import it without starting anything.

export const ZOOM_PORT = 8770;
export const ZOOM = `http://127.0.0.1:${ZOOM_PORT}`;
export const ZOOM_USER = {
  id: "zoom-user-stand-in",
  account_id: "zoom-account-stand-in",
  email: "host@harbour.test",
  display_name: "Harbour Host",
};

/** The one past meeting the account has, with a finished video and the sound alone. */
export function meeting(
  uuid = "past-meeting-1==",
  topic = "Client Kickoff",
  hostId = ZOOM_USER.id,
) {
  return {
    uuid,
    id: 987654321,
    host_id: hostId,
    topic,
    start_time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    duration: 37,
    recording_files: [
      {
        id: `${uuid}-video`,
        file_type: "MP4",
        file_size: 48_000_000,
        recording_type: "shared_screen_with_speaker_view",
        download_url: `http://127.0.0.1:8766/clip.webm`,
        status: "completed",
      },
      {
        id: `${uuid}-sound`,
        file_type: "M4A",
        file_size: 3_000_000,
        recording_type: "audio_only",
        download_url: `http://127.0.0.1:8766/clip.webm`,
        status: "completed",
      },
    ],
  };
}
