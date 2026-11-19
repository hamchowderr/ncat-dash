// Google Meet: what the dashboard reads from Google's Meet and Drive answers, and where it
// sends its requests. No database or network here.

/** One meeting that took place, as the Meet REST API lists it ("conference record"). */
export interface ConferenceRecord {
  name?: string;
  startTime?: string;
  endTime?: string;
  space?: string;
}

/** One recording made during a meeting. Meet saves it as an MP4 in the organizer's Drive. */
export interface MeetRecording {
  name?: string;
  state?: string;
  startTime?: string;
  endTime?: string;
  driveDestination?: { file?: string; exportUri?: string };
}

/** The Drive file behind a recording: its name carries the meeting's title. */
export interface DriveFile {
  id?: string;
  name?: string;
  /** Drive sends sizes as text. */
  size?: string;
  mimeType?: string;
  trashed?: boolean;
  /** When the file appeared in Drive: Meet saves it as the recording finishes. */
  createdTime?: string;
  /** Drive's reading of the video, once it has processed it. */
  videoMediaMetadata?: { durationMillis?: string };
  /** Whether Drive made a picture of the video. */
  hasThumbnail?: boolean;
  /** A short-lived address of that picture, read with the person's sign-in. */
  thumbnailLink?: string;
  /** Who the file belongs to. Missing for a file on a shared drive. */
  owners?: { displayName?: string; emailAddress?: string; me?: boolean }[];
}

/** Who shared a recording with the person: its owner, when that is someone else. */
export function sharedByOf(file: DriveFile): string | null {
  const owner = file.owners?.[0];
  if (!owner || owner.me) return null;
  return owner.displayName || owner.emailAddress || null;
}

/** The Drive fields the dashboard reads about a recording's file. */
export const DRIVE_FILE_FIELDS =
  "id,name,size,mimeType,trashed,createdTime,hasThumbnail,videoMediaMetadata(durationMillis),owners(displayName,emailAddress,me)";

/**
 * Which Drive files to list as Meet recordings. With the drive.meet.readonly access, Drive
 * only shows files Meet made, so this leaves out transcripts and notes (documents).
 */
export const DRIVE_RECORDINGS_QUERY = "mimeType contains 'video/' and trashed = false";

/** How long a Drive video runs, in whole minutes. Null when Drive has not read it yet. */
export function minutesOfFile(file: DriveFile): number | null {
  const ms = Number(file.videoMediaMetadata?.durationMillis ?? "");
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * Reading calendar events, only to name recordings Meet saved under a meeting code: the
 * dashboard works without it, so someone can untick it.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

/** The two the dashboard cannot work without; Google lets people untick them. */
export const NEEDED_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/drive.meet.readonly",
];

/**
 * What the dashboard asks Google for: who you are, your meetings, their recordings, and
 * your calendar's meeting names.
 */
export const GOOGLE_MEET_SCOPES = ["openid", "email", "profile", ...NEEDED_SCOPES, CALENDAR_SCOPE];

function grantedSet(scope: string | undefined): Set<string> {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean));
}

/** Whether Google granted everything needed, by the space-separated scopes it reports. */
export function grantedAll(scope: string | undefined): boolean {
  const granted = grantedSet(scope);
  return NEEDED_SCOPES.every((one) => granted.has(one));
}

/** Whether Google let the dashboard read calendar events, by the scopes it reports. */
export function grantedCalendar(scope: string | undefined): boolean {
  return grantedSet(scope).has(CALENDAR_SCOPE);
}

/**
 * Where each Google request goes. GOOGLE_MEET_STAND_IN_URL points all of them at one
 * stand-in, for the browser tests and local runs.
 */
export function googleUrls() {
  const standIn = (process.env.GOOGLE_MEET_STAND_IN_URL ?? "").replace(/\/+$/, "");
  if (standIn) {
    return {
      authorize: `${standIn}/o/oauth2/v2/auth`,
      token: `${standIn}/token`,
      revoke: `${standIn}/revoke`,
      userinfo: `${standIn}/v1/userinfo`,
      meet: `${standIn}/v2`,
      drive: `${standIn}/drive/v3`,
      calendar: `${standIn}/calendar/v3`,
    };
  }
  return {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    meet: "https://meet.googleapis.com/v2",
    drive: "https://www.googleapis.com/drive/v3",
    calendar: "https://www.googleapis.com/calendar/v3",
  };
}

/** A recording's name as the Meet API writes it, and nothing else (it goes in a path). */
export function isRecordingName(name: string): boolean {
  return /^conferenceRecords\/[A-Za-z0-9_-]+\/recordings\/[A-Za-z0-9_-]+$/.test(name);
}

/** A Drive file id, and nothing else (it goes in a path). */
export function isDriveFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{10,200}$/.test(id);
}

/**
 * The meeting's title, from the name Meet gives the recording in Drive:
 * "Weekly Sync (2026-11-18 10:02 GMT-8) - Recording" or
 * "Weekly Sync - 2026/11/18 10:02 PST - Recording" both give "Weekly Sync".
 */
export function meetingTitle(driveName: string | undefined): string {
  return (driveName ?? "")
    .replace(/\.(mp4|m4a|webm)$/i, "")
    .replace(/\s*[-–—]\s*Recording$/i, "")
    .replace(/\s*\(\d{4}[-/]\d{2}[-/]\d{2}[^)]*\)\s*$/, "")
    .replace(/\s*[-–—]\s*\d{4}\/\d{2}\/\d{2}\b.*$/, "")
    .trim();
}

/** Google sends times as ISO text. Unreadable text gives the fallback. */
export function timeOf(text: string | undefined, fallback: number): number {
  const at = Date.parse(text ?? "");
  return Number.isFinite(at) ? at : fallback;
}

/** How long a recording ran, in whole minutes. Null when Google did not say. */
export function minutesOf(recording: MeetRecording): number | null {
  const start = Date.parse(recording.startTime ?? "");
  const end = Date.parse(recording.endTime ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / 60_000));
}

/** A recording whose file Meet has finished saving to Drive, with that file's id. */
export function finishedFile(recording: MeetRecording): string | null {
  const file = recording.driveDestination?.file;
  if (recording.state !== "FILE_GENERATED" || !file || !isDriveFileId(file)) return null;
  return file;
}

/**
 * The meeting code Meet names a recording with when the meeting had no calendar invite
 * ("abc-defg-hij"), or null for a title someone gave.
 */
export function meetCodeOf(title: string): string | null {
  return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(title) ? title : null;
}

/** One event on the person's calendar, as far as naming a recording goes. */
export interface CalendarEvent {
  summary?: string;
  hangoutLink?: string;
  conferenceData?: { conferenceId?: string };
  attendees?: { displayName?: string; email?: string; self?: boolean; resource?: boolean }[];
}

/** The Calendar fields read about an event. */
export const CALENDAR_EVENT_FIELDS =
  "nextPageToken,items(summary,hangoutLink,conferenceData(conferenceId),attendees(displayName,email,self,resource))";

/** The Meet code of the call an event links to, or null when it has none. */
export function eventMeetCode(event: CalendarEvent): string | null {
  const id = event.conferenceData?.conferenceId;
  if (id && meetCodeOf(id)) return id;
  const link = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/.exec(event.hangoutLink ?? "");
  return link ? link[1] : null;
}

/**
 * What to call a recording from its calendar event: the event's title, or else who was
 * invited besides the person ("Call with Andrew Fink and Pat Rivera"). Null when the event
 * says neither.
 */
export function titleFromEvent(event: CalendarEvent): string | null {
  const summary = event.summary?.trim();
  if (summary) return summary;
  const names = (event.attendees ?? [])
    .filter((one) => !one.self && !one.resource)
    .map((one) => one.displayName?.trim() || one.email?.split("@")[0] || "")
    .filter(Boolean);
  if (names.length === 0) return null;
  if (names.length <= 2) return `Call with ${names.join(" and ")}`;
  return `Call with ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** The months (as UTC "YYYY-MM") a set of times fall in, newest first. */
export function monthsOf(times: number[]): string[] {
  const months = new Set(times.map((at) => new Date(at).toISOString().slice(0, 7)));
  return [...months].sort().reverse();
}
