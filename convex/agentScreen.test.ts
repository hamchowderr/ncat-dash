import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { detailsText } from "./agentScreen";
import { addPerson, addTeam, backend } from "./test.setup";

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const other = await addTeam(t, "Other Team");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const stranger = await addPerson(t, "Sam Lee", [other], "owner");
  return { t, team, other, maya, stranger };
}

describe("what the agent is told is on screen", () => {
  test("an automation for a client says who it is for and what starts it", async () => {
    const { team, maya } = await setUp();
    const automationId = await maya.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Clips for Northwind",
    });
    const client = await maya.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Northwind",
    });
    await maya.as.mutation(api.clients.setForAutomation, { automationId, clientId: client });

    const text = await maya.as.query(api.agentScreen.describe, {
      organizationId: team,
      kind: "automation",
      id: automationId,
    });
    expect(text).toContain('The automation "Clips for Northwind"');
    expect(text).toContain("It is off");
    expect(text).toContain("for the client Northwind");
    expect(text).toContain("Northwind's brand");
  });

  test("a video in the Library gives its length, shape, frame rate and sound", async () => {
    const { t, team, maya } = await setUp();
    const itemId = await t.run((ctx) =>
      ctx.db.insert("libraryItems", {
        organizationId: team,
        shortId: "V1",
        kind: "video",
        source: "upload",
        title: "Episode 12",
        tags: [],
        searchText: "V1 Episode 12",
        createdBy: "someone",
        details: { duration: 81.2, width: 1080, height: 1920, fps: 29.97, hasAudio: true },
        transcript: { status: "ready", at: 1 },
      }),
    );
    const text = await maya.as.query(api.agentScreen.describe, {
      organizationId: team,
      kind: "library",
      id: itemId,
    });
    expect(text).toContain('The video "Episode 12" in the Library (V1)');
    expect(text).toContain("1 min 21 s, 1080x1920 (9:16, vertical), 29.97 fps, with sound");
    expect(text).toContain("transcribed");
    expect(text).not.toContain("client");
  });

  test("tells nothing about another team's things, or to someone not on the team", async () => {
    const { team, other, maya, stranger } = await setUp();
    const theirs = await stranger.as.mutation(api.automations.create, {
      organizationId: other,
      name: "Their automation",
    });
    // Another team's id, asked for under one's own team: nothing.
    expect(
      await maya.as.query(api.agentScreen.describe, {
        organizationId: team,
        kind: "automation",
        id: theirs,
      }),
    ).toBeNull();
    // Someone not on the team cannot ask at all.
    await expect(
      stranger.as.query(api.agentScreen.describe, {
        organizationId: team,
        kind: "automation",
        id: theirs,
      }),
    ).rejects.toThrow();
    // An id that is not an id at all: nothing.
    expect(
      await maya.as.query(api.agentScreen.describe, {
        organizationId: team,
        kind: "project",
        id: "not-an-id",
      }),
    ).toBeNull();
  });
});

describe("which client the thing on screen is for", () => {
  test("an automation for a client, the client page, and nothing for the team's own", async () => {
    const { team, maya } = await setUp();
    const automationId = await maya.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Clips for Northwind",
    });
    const own = await maya.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Our own clips",
    });
    const client = await maya.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Northwind",
    });
    await maya.as.mutation(api.clients.setForAutomation, { automationId, clientId: client });

    const ask = (kind: "automation" | "client", id: string) =>
      maya.as.query(api.agentScreen.clientOf, { organizationId: team, kind, id });
    expect(await ask("automation", automationId)).toEqual({ id: client, name: "Northwind" });
    expect(await ask("client", client)).toEqual({ id: client, name: "Northwind" });
    expect(await ask("automation", own)).toBeNull();
  });

  test("never names another team's client", async () => {
    const { team, other, stranger, maya } = await setUp();
    const theirs = await stranger.as.mutation(api.clients.create, {
      organizationId: other,
      name: "Their client",
    });
    expect(
      await maya.as.query(api.agentScreen.clientOf, {
        organizationId: team,
        kind: "client",
        id: theirs,
      }),
    ).toBeNull();
    await expect(
      stranger.as.query(api.agentScreen.clientOf, {
        organizationId: team,
        kind: "client",
        id: theirs,
      }),
    ).rejects.toThrow();
  });
});

describe("a file's details in words", () => {
  test("covers wide, square and audio-only files, and nothing when there are none", () => {
    expect(detailsText({ duration: 3725, width: 1920, height: 1080, hasAudio: false })).toBe(
      "1 h 2 min 5 s, 1920x1080 (16:9, wide), no sound",
    );
    expect(detailsText({ width: 1080, height: 1080 })).toBe("1080x1080 (1:1, square)");
    expect(detailsText({ duration: 30, hasVideo: false, hasAudio: true })).toBe(
      "30 s, audio only, with sound",
    );
    expect(detailsText(undefined)).toBeNull();
    expect(detailsText({})).toBeNull();
  });
});
