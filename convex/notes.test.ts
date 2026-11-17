import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { MAX_NOTE_CHARS, MAX_NOTES } from "./notes";
import { addPerson, addTeam, backend } from "./test.setup";

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const automationId = await maya.as.mutation(api.automations.create, {
    organizationId: team,
    name: "Clips for the week",
  });
  return { t, team, maya, automationId };
}

describe("notes on an automation's canvas", () => {
  test("are added where asked, written in, moved and sized, and seen by the team", async () => {
    const { t, team, maya, automationId } = await setUp();
    const sam = await addPerson(t, "Sam Lee", [team]);
    const noteId = await maya.as.mutation(api.notes.add, { automationId, x: 40.4, y: -12.6 });
    await maya.as.mutation(api.notes.update, {
      noteId,
      text: "Captions only run for clips under a minute.",
    });
    await maya.as.mutation(api.notes.update, { noteId, x: 300, y: 200, width: 320, height: 160 });

    expect(await sam.as.query(api.notes.list, { automationId })).toEqual([
      {
        _id: noteId,
        text: "Captions only run for clips under a minute.",
        x: 300,
        y: 200,
        width: 320,
        height: 160,
      },
    ]);
  });

  test("start empty at a set size, rounded to whole places", async () => {
    const { maya, automationId } = await setUp();
    await maya.as.mutation(api.notes.add, { automationId, x: 40.4, y: -12.6 });
    const [note] = await maya.as.query(api.notes.list, { automationId });
    expect(note).toMatchObject({ text: "", x: 40, y: -13, width: 220, height: 140 });
  });

  test("keep their size within limits", async () => {
    const { maya, automationId } = await setUp();
    const noteId = await maya.as.mutation(api.notes.add, { automationId, x: 0, y: 0 });
    await maya.as.mutation(api.notes.update, { noteId, width: 10, height: 5000 });
    const [note] = await maya.as.query(api.notes.list, { automationId });
    expect(note).toMatchObject({ width: 120, height: 800 });
  });

  test("refuse text that is too long, and places off the canvas", async () => {
    const { maya, automationId } = await setUp();
    const noteId = await maya.as.mutation(api.notes.add, { automationId, x: 0, y: 0 });
    await expect(
      maya.as.mutation(api.notes.update, { noteId, text: "a".repeat(MAX_NOTE_CHARS + 1) }),
    ).rejects.toThrow(/at most/);
    await expect(
      maya.as.mutation(api.notes.update, { noteId, x: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(/not a place/);
    await expect(
      maya.as.mutation(api.notes.add, { automationId, x: Number.NaN, y: 0 }),
    ).rejects.toThrow(/not a place/);
  });

  test(`stop at ${MAX_NOTES} on one automation`, async () => {
    const { t, maya, automationId } = await setUp();
    for (let i = 0; i < MAX_NOTES; i++) {
      await maya.as.mutation(api.notes.add, { automationId, x: i * 10, y: 0 });
    }
    await expect(maya.as.mutation(api.notes.add, { automationId, x: 0, y: 0 })).rejects.toThrow(
      `at most ${MAX_NOTES} notes`,
    );
    expect(await t.run((ctx) => ctx.db.query("automationNotes").collect())).toHaveLength(MAX_NOTES);
  });

  test("are kept from people outside the team", async () => {
    const { t, maya, automationId } = await setUp();
    const other = await addTeam(t, "Other Studio");
    const outsider = await addPerson(t, "Rex Doe", [other]);
    const noteId = await maya.as.mutation(api.notes.add, { automationId, x: 0, y: 0 });

    expect(await outsider.as.query(api.notes.list, { automationId })).toEqual([]);
    await expect(
      outsider.as.mutation(api.notes.add, { automationId, x: 0, y: 0 }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.notes.update, { noteId, text: "Hello" }),
    ).rejects.toThrow();
    await expect(outsider.as.mutation(api.notes.remove, { noteId })).rejects.toThrow();
    expect(await maya.as.query(api.notes.list, { automationId })).toHaveLength(1);
  });

  test("are removed one by one, and all together with their automation", async () => {
    const { t, maya, automationId } = await setUp();
    const first = await maya.as.mutation(api.notes.add, { automationId, x: 0, y: 0 });
    await maya.as.mutation(api.notes.add, { automationId, x: 300, y: 0 });
    await maya.as.mutation(api.notes.remove, { noteId: first });
    expect(await maya.as.query(api.notes.list, { automationId })).toHaveLength(1);

    await maya.as.mutation(api.automations.remove, { automationId });
    expect(await t.run((ctx) => ctx.db.query("automationNotes").collect())).toEqual([]);
  });
});
