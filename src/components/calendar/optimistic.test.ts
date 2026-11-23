import { api } from "@convex/_generated/api";
import type { OptimisticLocalStore } from "convex/browser";
import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, test } from "vitest";

import { movePostLocally, setDueLocally } from "./optimistic";

/** The browser's copy of the answers it holds, as Convex hands it to an optimistic update. */
function localStore(entries: [FunctionReference<"query">, Record<string, unknown>, unknown][]) {
  const held = entries.map(([query, args, value]) => ({
    name: getFunctionName(query),
    args,
    value,
  }));
  const store = {
    getAllQueries: (query: FunctionReference<"query">) =>
      held.filter((entry) => entry.name === getFunctionName(query)),
    getQuery: (query: FunctionReference<"query">, args: Record<string, unknown>) =>
      held.find(
        (entry) =>
          entry.name === getFunctionName(query) &&
          JSON.stringify(entry.args) === JSON.stringify(args),
      )?.value,
    setQuery: (
      query: FunctionReference<"query">,
      args: Record<string, unknown>,
      value: unknown,
    ) => {
      const entry = held.find((row) => row.name === getFunctionName(query) && row.args === args)!;
      entry.value = value;
    },
  };
  const read = (query: FunctionReference<"query">, index = 0) =>
    store.getAllQueries(query)[index].value as Record<string, { _id: string }[]>;
  return { store: store as unknown as OptimisticLocalStore, read };
}

const ORG = { organizationId: "team_1" };
const NOVEMBER = { ...ORG, from: 1000, to: 2000 };
const DECEMBER = { ...ORG, from: 2000, to: 3000 };
const post = (id: string, at: number | null, more: Record<string, unknown> = {}) => ({
  _id: id,
  title: id,
  platform: "tiktok",
  at,
  queued: false,
  status: "planned",
  fromSlot: false,
  file: null,
  client: null,
  ...more,
});
const due = (id: string, dueAt: number | null) => ({
  _id: id,
  label: id,
  kind: "short",
  status: "in_progress",
  dueAt,
  project: { _id: "p1", name: "Episode 7" },
});
const rangeOf = (posts: unknown[], dues: unknown[] = []) => ({
  posts,
  due: dues,
  openSlots: [],
  runs: [],
  repeating: [],
});

// A drop is drawn where it lands at once; the server's answer replaces the guess later.
describe("a drop shows where it lands before the server answers", () => {
  test("a post dragged to another day moves there, keeping the days in order", () => {
    const { store, read } = localStore([
      [api.calendar.range, NOVEMBER, rangeOf([post("a", 1100), post("b", 1500)])],
      [api.calendar.waiting, ORG, { posts: [], deliverables: [] }],
    ]);
    movePostLocally(store, { postId: "a" as never, at: 1700 });
    expect(read(api.calendar.range).posts.map((entry) => entry._id)).toEqual(["b", "a"]);
    expect(read(api.calendar.range).posts[1]).toMatchObject({ at: 1700 });
  });

  test("a post from the side list lands on the calendar, and back again", () => {
    const { store, read } = localStore([
      [api.calendar.range, NOVEMBER, rangeOf([])],
      [api.calendar.waiting, ORG, { posts: [post("q", null, { queued: true })], deliverables: [] }],
    ]);
    movePostLocally(store, { postId: "q" as never, at: 1200 });
    expect(read(api.calendar.range).posts).toEqual([
      expect.objectContaining({ _id: "q", at: 1200, queued: false }),
    ]);
    expect(read(api.calendar.waiting).posts).toEqual([]);

    movePostLocally(store, { postId: "q" as never, at: null });
    expect(read(api.calendar.range).posts).toEqual([]);
    expect(read(api.calendar.waiting).posts).toEqual([
      expect.objectContaining({ _id: "q", at: null }),
    ]);
  });

  test("a post moved past the month leaves it and joins the next one held", () => {
    const { store, read } = localStore([
      [api.calendar.range, NOVEMBER, rangeOf([post("a", 1100)])],
      [api.calendar.range, DECEMBER, rangeOf([])],
    ]);
    movePostLocally(store, { postId: "a" as never, at: 2500 });
    expect(read(api.calendar.range, 0).posts).toEqual([]);
    expect(read(api.calendar.range, 1).posts.map((entry) => entry._id)).toEqual(["a"]);
  });

  test("a view of one client's calendar only takes that client's posts", () => {
    const { store, read } = localStore([
      [api.calendar.range, NOVEMBER, rangeOf([post("a", 1100, { client: { _id: "c1" } })])],
      [api.calendar.range, { ...NOVEMBER, clientId: "c2" }, rangeOf([])],
    ]);
    movePostLocally(store, { postId: "a" as never, at: 1300 });
    expect(read(api.calendar.range, 0).posts.map((entry) => entry._id)).toEqual(["a"]);
    expect(read(api.calendar.range, 1).posts).toEqual([]);
  });

  test("a project slot is given a due date, moved, and cleared", () => {
    const { store, read } = localStore([
      [api.calendar.range, NOVEMBER, rangeOf([], [])],
      [api.calendar.waiting, ORG, { posts: [], deliverables: [due("s1", null)] }],
    ]);
    setDueLocally(store, { deliverableId: "s1" as never, dueAt: 1400 });
    expect(read(api.calendar.range).due).toEqual([
      expect.objectContaining({ _id: "s1", dueAt: 1400 }),
    ]);
    expect(read(api.calendar.waiting).deliverables).toEqual([]);

    setDueLocally(store, { deliverableId: "s1" as never, dueAt: null });
    expect(read(api.calendar.range).due).toEqual([]);
    expect(read(api.calendar.waiting).deliverables).toEqual([
      expect.objectContaining({ _id: "s1", dueAt: null }),
    ]);
  });

  test("something the page does not hold is left alone", () => {
    const { store, read } = localStore([
      [api.calendar.range, NOVEMBER, rangeOf([post("a", 1100)])],
    ]);
    movePostLocally(store, { postId: "gone" as never, at: 1200 });
    setDueLocally(store, { deliverableId: "gone" as never, dueAt: 1200 });
    expect(read(api.calendar.range).posts.map((entry) => entry._id)).toEqual(["a"]);
  });
});
