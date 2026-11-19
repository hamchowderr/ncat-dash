import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

describe("the motion guide the agent reads", () => {
  test("gives the preset styles by id and the pieces they draw", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team]);
    const { text } = await maya.as.query(api.automations.motionGuide, {});
    expect(text).toContain("## Preset styles");
    expect(text).toContain("- clean-talking-head (");
    expect(text).toContain("## Pieces");
  });

  test("is closed to visitors", async () => {
    const t = backend();
    await expect(t.query(api.automations.motionGuide, {})).rejects.toThrow(/Sign in/);
  });
});
