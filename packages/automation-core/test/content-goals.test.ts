import { describe, expect, it } from "vitest";

import {
  appsForPlacements,
  CONTENT_KINDS,
  contentGoalsProblem,
  getPlatform,
  graphProblem,
  missingSettings,
  nodesForPlatform,
  placementsFor,
  POSTING_APPS,
  STARTERS,
  suggestedStarters,
  clashes,
  recordsMeetings,
} from "../src";

describe("content goals", () => {
  it("only suggests ready-made automations that exist", () => {
    for (const kind of CONTENT_KINDS) {
      expect(kind.starters.length, kind.id).toBeGreaterThan(0);
      for (const id of kind.starters) {
        expect(
          STARTERS.some((starter) => starter.id === id),
          `${kind.id}: ${id}`,
        ).toBe(true);
      }
    }
  });

  it("gives a coach one pick: the coaching session pack", () => {
    expect(suggestedStarters(["coaching"]).map((starter) => starter.id)).toEqual([
      "coaching-session-pack",
    ]);
  });

  it("gives an entrepreneur speaker clips", () => {
    expect(suggestedStarters(["entrepreneurs"]).map((starter) => starter.id)).toEqual([
      "clips-follow-speaker",
    ]);
  });

  it("knows which kinds are recorded on calls", () => {
    expect(recordsMeetings(["coaching"])).toBe(true);
    expect(recordsMeetings(["music", "business"])).toBe(false);
    expect(recordsMeetings(["music", "podcast"])).toBe(true);
  });

  it("never offers two that make clips from the same upload", () => {
    expect(suggestedStarters(["coaching", "entrepreneurs"]).map((starter) => starter.id)).toEqual(
      ["coaching-session-pack", "caption-uploads"],
    );
    const every = suggestedStarters(CONTENT_KINDS.map((kind) => kind.id));
    for (const one of every) {
      for (const other of every) if (one !== other) expect(clashes(one, other)).toBe(false);
    }
    expect(every.length).toBeLessThanOrEqual(CONTENT_KINDS.length);
  });

  it("names every kind in Title Case", () => {
    for (const kind of CONTENT_KINDS) {
      for (const word of kind.label.split(" ")) {
        if (!["or", "and"].includes(word)) expect(word[0], kind.label).toBe(word[0].toUpperCase());
      }
    }
  });

  it("offers one per kind, each once, in the order the kinds are listed", () => {
    const ids = suggestedStarters(["talks", "coaching"]).map((starter) => starter.id);
    expect(ids).toEqual(["coaching-session-pack", "recording-pack"]);
    expect(suggestedStarters([])).toEqual([]);
    expect(suggestedStarters(["nothing"])).toEqual([]);
  });

  it("maps every posting app to a Clips platform and back", () => {
    for (const app of POSTING_APPS) expect(getPlatform(app.placement), app.id).toBeDefined();
    expect(placementsFor(["youtube", "tiktok"])).toEqual(["TikTok", "YouTube Shorts"]);
    expect(appsForPlacements(["YouTube Shorts", "TikTok", "YouTube"])).toEqual([
      "tiktok",
      "youtube",
    ]);
  });

  it("explains answers that cannot be saved", () => {
    expect(contentGoalsProblem({ kinds: [], apps: [] })).toMatch(/at least one/);
    expect(contentGoalsProblem({ kinds: ["juggling"], apps: [] })).toMatch(/not one we know/);
    expect(contentGoalsProblem({ kinds: ["podcast"], apps: ["myspace"] })).toMatch(/app/);
    expect(contentGoalsProblem({ kinds: ["podcast"], apps: [] })).toBeNull();
  });

  it("makes clips for the first platform picked", () => {
    const pack = STARTERS.find((starter) => starter.id === "coaching-session-pack")!;
    const made = nodesForPlatform(pack.nodes, "TikTok");
    expect(made.find((node) => node.kind === "moments")?.input.platform).toBe("TikTok");
    // Steps that do not make clips are left alone.
    expect(made.find((node) => node.kind === "chapters")?.input).toEqual({});
    expect(nodesForPlatform(pack.nodes, undefined)).toBe(pack.nodes);
    expect(nodesForPlatform(pack.nodes, "Myspace")).toBe(pack.nodes);
  });
});

describe("coaching session pack", () => {
  const pack = STARTERS.find((starter) => starter.id === "coaching-session-pack")!;

  it("chapters the session, cuts its best moments, captions them and transcribes it", () => {
    expect(pack.trigger).toEqual({ kind: "upload", fileType: "video" });
    expect(pack.nodes.map((node) => node.kind)).toEqual(["chapters", "moments", "step", "step"]);
    expect(pack.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      "chapters_1>moments_1",
      "moments_1>caption_1",
      "chapters_1>transcribe_1",
    ]);
  });

  it("is complete as it comes", () => {
    expect(graphProblem(pack.nodes, pack.edges)).toBeNull();
    for (const node of pack.nodes) expect(missingSettings(node), node.id).toEqual([]);
  });
});
