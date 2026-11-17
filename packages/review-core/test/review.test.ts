import { describe, expect, it } from "vitest";

import {
  clipTitleFrom,
  completeMention,
  formatMoment,
  initialsOf,
  isVideoUrl,
  matchPeople,
  mentionedIn,
  mentionQuery,
  momentPercent,
  openCount,
  splitBody,
  threadComments,
} from "../src";

const people = [
  { id: "u1", name: "Maya Okafor" },
  { id: "u2", name: "Sam" },
  { id: "u3", name: "Sam Lee" },
];

describe("moments", () => {
  it("writes a moment the way people say it", () => {
    expect(formatMoment(0)).toBe("0:00");
    expect(formatMoment(8.9)).toBe("0:08");
    expect(formatMoment(760)).toBe("12:40");
    expect(formatMoment(3723)).toBe("1:02:03");
    expect(formatMoment(-4)).toBe("0:00");
    expect(formatMoment(Number.NaN)).toBe("0:00");
  });

  it("places a moment along the timeline and stays inside it", () => {
    expect(momentPercent(6, 24)).toBe(25);
    expect(momentPercent(30, 24)).toBe(100);
    expect(momentPercent(-1, 24)).toBe(0);
    expect(momentPercent(5, 0)).toBe(0);
  });
});

describe("clips", () => {
  it("knows a video by its ending, with or without a query", () => {
    expect(isVideoUrl("https://cdn.example/a/clip.mp4")).toBe(true);
    expect(isVideoUrl("https://cdn.example/a/clip.MOV?sig=1")).toBe(true);
    expect(isVideoUrl("https://cdn.example/a/thumb.png")).toBe(false);
  });

  it("names a clip from its address", () => {
    expect(clipTitleFrom("https://cdn.example/out/station_interview-02.mp4")).toBe(
      "Station interview 02",
    );
    expect(clipTitleFrom("https://cdn.example/out/My%20cut.mp4?x=1")).toBe("My cut");
    expect(clipTitleFrom("")).toBe("Clip");
  });
});

describe("threads", () => {
  const comment = (
    id: string,
    time: number,
    createdAt: number,
    parentId: string | null = null,
  ) => ({
    id,
    time,
    createdAt,
    parentId,
    resolved: false,
  });

  it("orders threads by their moment, then by when they were written", () => {
    const threads = threadComments([
      comment("late", 17, 1),
      comment("early", 8, 5),
      comment("same-moment", 8, 2),
      comment("reply-2", 8, 9, "early"),
      comment("reply-1", 8, 7, "early"),
    ]);
    expect(threads.map((thread) => thread.root.id)).toEqual(["same-moment", "early", "late"]);
    expect(threads[1].replies.map((reply) => reply.id)).toEqual(["reply-1", "reply-2"]);
  });

  it("leaves out a reply whose first comment is gone", () => {
    expect(threadComments([comment("orphan", 3, 1, "missing")])).toEqual([]);
  });

  it("counts threads that are not resolved, not replies", () => {
    const comments = [
      comment("a", 1, 1),
      { ...comment("b", 2, 2), resolved: true },
      comment("c", 1, 3, "a"),
    ];
    expect(openCount(comments)).toBe(1);
  });
});

describe("mentions", () => {
  it("finds a mention by full name, whatever its capitals", () => {
    expect(mentionedIn("@maya okafor can you check 0:08?", people)).toEqual(["u1"]);
  });

  it("prefers the longer name when two start the same", () => {
    expect(mentionedIn("@Sam Lee and @Sam, look", people)).toEqual(["u3", "u2"]);
  });

  it("does not read part of a longer word, or an email address, as a mention", () => {
    expect(mentionedIn("@Samantha is out", people)).toEqual([]);
    expect(mentionedIn("write to ops@Sam.example", people)).toEqual([]);
  });

  it("lists a person once", () => {
    expect(mentionedIn("@Sam @Sam @Sam", people)).toEqual(["u2"]);
  });

  it("splits a comment into text and mentions without losing a character", () => {
    const body = "Hi @Maya Okafor, see (@Sam).";
    const parts = splitBody(body, people);
    expect(parts.map((part) => part.text).join("")).toBe(body);
    expect(parts.filter((part) => part.mention).map((part) => part.mention?.id)).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("copes with names that hold pattern characters", () => {
    expect(mentionedIn("@A+B (ops) hello", [{ id: "x", name: "A+B (ops)" }])).toEqual(["x"]);
  });

  it("returns the text whole when nobody is on the team list", () => {
    expect(splitBody("@Maya hello", [])).toEqual([{ text: "@Maya hello" }]);
    expect(splitBody("", people)).toEqual([]);
  });
});

describe("writing a mention", () => {
  it("knows when a mention is being typed", () => {
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("see @ma")).toBe("ma");
    expect(mentionQuery("see @Sam L")).toBe("Sam L");
    expect(mentionQuery("mail me at a@b")).toBeNull();
    expect(mentionQuery("@Sam thanks for the quick fix")).toBeNull();
    expect(mentionQuery("no mention here")).toBeNull();
  });

  it("offers people by the start of any word in their name", () => {
    expect(matchPeople("ok", people).map((person) => person.id)).toEqual(["u1"]);
    expect(matchPeople("sam", people).map((person) => person.id)).toEqual(["u2", "u3"]);
    expect(matchPeople("", people)).toHaveLength(3);
    expect(matchPeople("zed", people)).toEqual([]);
  });

  it("finishes the mention with the chosen name", () => {
    expect(completeMention("see @ma", people[0])).toBe("see @Maya Okafor ");
  });
});

describe("initials", () => {
  it("stands for a person in two letters", () => {
    expect(initialsOf("Maya Okafor")).toBe("MO");
    expect(initialsOf("sam")).toBe("SA");
    expect(initialsOf("Ana Maria de Souza")).toBe("AS");
    expect(initialsOf("  ")).toBe("?");
  });
});
