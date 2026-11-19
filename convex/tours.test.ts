import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

describe("the guided tours", () => {
  test("has not ended for someone new, and has once they finish it", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    expect(await maya.as.query(api.tours.ended, { tourId: "dashboard" })).toBe(false);

    await maya.as.mutation(api.tours.end, { tourId: "dashboard", how: "finished" });
    expect(await maya.as.query(api.tours.ended, { tourId: "dashboard" })).toBe(true);
  });

  test("closing it part way counts too, and ending it again keeps one note", async () => {
    const t = backend();
    const sam = await addPerson(t, "Sam Lee");
    await sam.as.mutation(api.tours.end, { tourId: "dashboard", how: "closed" });
    await sam.as.mutation(api.tours.end, { tourId: "dashboard", how: "finished" });
    expect(await sam.as.query(api.tours.ended, { tourId: "dashboard" })).toBe(true);
    const notes = await t.run((ctx) => ctx.db.query("tourEnds").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: sam.id, how: "finished" });
  });

  test("is each person's own: one teammate finishing it leaves the other's to start", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    const sam = await addPerson(t, "Sam Lee", [team]);
    await maya.as.mutation(api.tours.end, { tourId: "dashboard", how: "finished" });
    expect(await sam.as.query(api.tours.ended, { tourId: "dashboard" })).toBe(false);
  });

  test("keeps each tour apart: finishing the dashboard's leaves the calendar's to start", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.tours.end, { tourId: "dashboard", how: "finished" });
    expect(await maya.as.query(api.tours.ended, { tourId: "calendar" })).toBe(false);
    await maya.as.mutation(api.tours.end, { tourId: "calendar", how: "closed" });
    expect(await maya.as.query(api.tours.ended, { tourId: "calendar" })).toBe(true);
    const notes = await t.run((ctx) => ctx.db.query("tourEnds").collect());
    expect(notes.map((note) => note.tourId).sort()).toEqual(["calendar", "dashboard"]);
  });

  test("needs someone signed in", async () => {
    const t = backend();
    await expect(t.query(api.tours.ended, { tourId: "dashboard" })).rejects.toThrow(/Sign in/);
    await expect(t.mutation(api.tours.end, { tourId: "dashboard", how: "closed" })).rejects.toThrow(
      /Sign in/,
    );
  });
});
