import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";

// A drag is drawn where it lands the moment it is dropped, before the server answers.
// The test copy's server takes up to a second to save and send the calendar back, which
// made every drop look stuck. When the answer comes, Convex swaps this guess for it; if
// the save fails, the guess is dropped and the entry goes back where it was.

const inRange = (at: number | null, args: { from: number; to: number }) =>
  at !== null && at >= args.from && at < args.to;

/** Moves a post on every calendar range and side list the page holds. */
export function movePostLocally(
  store: OptimisticLocalStore,
  { postId, at }: { postId: Id<"calendarPosts">; at: number | null },
) {
  const ranges = store.getAllQueries(api.calendar.range);
  const waiting = store.getAllQueries(api.calendar.waiting);
  const found =
    ranges.flatMap(({ value }) => value?.posts ?? []).find((post) => post._id === postId) ??
    waiting.flatMap(({ value }) => value?.posts ?? []).find((post) => post._id === postId);
  if (!found) return;
  const moved = { ...found, at, queued: false, fromSlot: false };
  const forClient = (clientId?: Id<"clients">) => !clientId || moved.client?._id === clientId;

  for (const { args, value } of ranges) {
    if (!value) continue;
    const posts = value.posts.filter((post) => post._id !== postId);
    if (inRange(at, args) && forClient(args.clientId)) {
      posts.push(moved);
      posts.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    }
    store.setQuery(api.calendar.range, args, { ...value, posts });
  }
  for (const { args, value } of waiting) {
    if (!value) continue;
    const posts = value.posts.filter((post) => post._id !== postId);
    if (at === null && forClient(args.clientId)) posts.push(moved);
    store.setQuery(api.calendar.waiting, args, { ...value, posts });
  }
}

/** Moves a project slot's due date on every calendar range and side list the page holds. */
export function setDueLocally(
  store: OptimisticLocalStore,
  { deliverableId, dueAt }: { deliverableId: Id<"deliverables">; dueAt: number | null },
) {
  const ranges = store.getAllQueries(api.calendar.range);
  const waiting = store.getAllQueries(api.calendar.waiting);
  // A slot only shows for the clients it was already listed under, so it moves only
  // within answers for those (or for every client).
  const listedFor = new Set<string>();
  let found: NonNullable<(typeof ranges)[number]["value"]>["due"][number] | undefined;
  for (const { args, value } of ranges) {
    const hit = value?.due.find((due) => due._id === deliverableId);
    if (hit) {
      found = hit;
      listedFor.add(args.clientId ?? "");
    }
  }
  for (const { args, value } of waiting) {
    const hit = value?.deliverables.find((due) => due._id === deliverableId);
    if (hit) {
      found ??= hit;
      listedFor.add(args.clientId ?? "");
    }
  }
  if (!found) return;
  const moved = { ...found, dueAt };
  const forClient = (clientId?: Id<"clients">) => !clientId || listedFor.has(clientId);

  for (const { args, value } of ranges) {
    if (!value) continue;
    const due = value.due.filter((entry) => entry._id !== deliverableId);
    if (inRange(dueAt, args) && forClient(args.clientId)) due.push(moved);
    store.setQuery(api.calendar.range, args, { ...value, due });
  }
  for (const { args, value } of waiting) {
    if (!value) continue;
    const deliverables = value.deliverables.filter((entry) => entry._id !== deliverableId);
    if (dueAt === null && forClient(args.clientId)) deliverables.push(moved);
    store.setQuery(api.calendar.waiting, args, { ...value, deliverables });
  }
}
