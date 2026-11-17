/**
 * The rules of a review room that need no screen and no database: how a moment in a clip
 * is written, how comments group into threads, who a comment mentions, and where a
 * comment sits on the timeline. The Convex functions and the room screen both read
 * from here, and so will the agent when it is tagged in a comment.
 */

export const COMMENT_LIMIT = 4000;
export const TITLE_LIMIT = 120;

/** A moment in a clip the way people say it: 0:08, 12:40, 1:02:03. */
export function formatMoment(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Where a moment falls along a timeline, from 0 to 100. */
export function momentPercent(seconds: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(seconds)) return 0;
  return Math.min(100, Math.max(0, (seconds / duration) * 100));
}

const VIDEO = /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i;

/** Whether an address looks like a video the browser can try to play. */
export function isVideoUrl(url: string): boolean {
  return VIDEO.test(url);
}

/** A readable name for a clip from its address: "clip_02.mp4" becomes "Clip 02". */
export function clipTitleFrom(url: string): string {
  let name = url;
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? url);
  } catch {
    // Not an address; use it as it is.
  }
  const plain = name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const title = plain || "Clip";
  return (title[0].toUpperCase() + title.slice(1)).slice(0, TITLE_LIMIT);
}

export type ReviewComment = {
  id: string;
  parentId: string | null;
  /** Seconds into the clip. A reply carries its thread's moment. */
  time: number;
  createdAt: number;
  resolved: boolean;
};

export type Thread<C extends ReviewComment> = { root: C; replies: C[] };

/**
 * Comments grouped into threads, in the order of the clip: earliest moment first, and
 * for the same moment the one written first. Replies follow in the order they were
 * written. A reply whose first comment is gone is left out.
 */
export function threadComments<C extends ReviewComment>(comments: C[]): Thread<C>[] {
  const threads = new Map<string, Thread<C>>();
  for (const comment of comments) {
    if (comment.parentId === null) threads.set(comment.id, { root: comment, replies: [] });
  }
  for (const comment of comments) {
    if (comment.parentId !== null) threads.get(comment.parentId)?.replies.push(comment);
  }
  const ordered = [...threads.values()].sort(
    (a, b) => a.root.time - b.root.time || a.root.createdAt - b.root.createdAt,
  );
  for (const thread of ordered) thread.replies.sort((a, b) => a.createdAt - b.createdAt);
  return ordered;
}

/** How many threads still need attention. */
export function openCount<C extends ReviewComment>(comments: C[]): number {
  return comments.filter((comment) => comment.parentId === null && !comment.resolved).length;
}

export type Mentionable = { id: string; name: string };

export type BodyPart = { text: string; mention?: Mentionable };

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A comment split into plain text and mentions. A mention is "@" followed by a person's
 * full name as it is on the team, matched whatever its capitals. Longer names win, so
 * "@Sam Lee" is not read as "@Sam" when both are on the team.
 */
export function splitBody(body: string, people: Mentionable[]): BodyPart[] {
  const named = people
    .filter((person) => person.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length);
  if (named.length === 0) return body === "" ? [] : [{ text: body }];

  const pattern = new RegExp(
    `@(${named.map((person) => escapeForPattern(person.name.trim())).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const parts: BodyPart[] = [];
  let from = 0;
  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0;
    // "@" in the middle of a word, as in an email address, is not a mention.
    if (at > 0 && /[\p{L}\p{N}_.]/u.test(body[at - 1])) continue;
    const person = named.find(
      (candidate) => candidate.name.trim().toLowerCase() === match[1].toLowerCase(),
    );
    if (!person) continue;
    if (at > from) parts.push({ text: body.slice(from, at) });
    parts.push({ text: match[0], mention: person });
    from = at + match[0].length;
  }
  if (from < body.length) parts.push({ text: body.slice(from) });
  return parts;
}

/** The people a comment mentions, each once, in the order they appear. */
export function mentionedIn(body: string, people: Mentionable[]): string[] {
  const ids: string[] = [];
  for (const part of splitBody(body, people)) {
    if (part.mention && !ids.includes(part.mention.id)) ids.push(part.mention.id);
  }
  return ids;
}

/**
 * What is being typed after an "@" at the end of the text, for offering names. Null when
 * the text does not end in a mention being written.
 */
export function mentionQuery(text: string): string | null {
  const match = /(^|[\s(])@([\p{L}\p{N}_ ]{0,40})$/u.exec(text);
  if (!match) return null;
  // Two words is as far as a name is followed; after that it is ordinary writing.
  return match[2].split(" ").length > 3 ? null : match[2];
}

/** The people whose name starts with, or has a word starting with, what was typed. */
export function matchPeople<P extends Mentionable>(query: string, people: P[]): P[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return people;
  return people.filter((person) => {
    const name = person.name.toLowerCase();
    return name.startsWith(wanted) || name.split(/\s+/).some((word) => word.startsWith(wanted));
  });
}

/** The text with the mention being typed replaced by the chosen person's name. */
export function completeMention(text: string, person: Mentionable): string {
  return text.replace(/@([\p{L}\p{N}_ ]{0,40})$/u, `@${person.name.trim()} `);
}

/** Up to two letters to stand for a person where there is no picture. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

export type ReviewStatus = "open" | "approved" | "rejected";

export function statusLabel(status: ReviewStatus): string {
  return status === "approved"
    ? "Approved"
    : status === "rejected"
      ? "Changes needed"
      : "In review";
}

/** The dashboard's agent, offered after "@" beside the team. */
export const AGENT: Mentionable = { id: "agent", name: "Agent" };

/** Whether a comment asks the agent for an answer. */
export function asksAgent(body: string): boolean {
  return mentionedIn(body, [AGENT]).length > 0;
}

/** The longest an answer from the agent may be, as it is kept with the comments. */
export const AGENT_ANSWER_LIMIT = 4000;
