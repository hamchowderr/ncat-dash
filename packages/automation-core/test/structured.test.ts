import { describe, expect, it } from "vitest";

import { missingInRows, settingShape, tidySetting, tidyTime, type SettingSchema } from "../src";

const range: SettingSchema = {
  type: "array",
  items: {
    type: "object",
    properties: { start: { type: "string" }, end: { type: "string" } },
    required: ["start", "end"],
  },
};

describe("list and group settings", () => {
  it("picks an editor for each kind of setting", () => {
    expect(settingShape(range)).toBe("list");
    expect(settingShape(range.items!)).toBe("group");
    expect(settingShape({ type: "object", additionalProperties: { type: "string" } })).toBe(
      "pairs",
    );
    expect(settingShape({ type: ["string", "number", "null"] })).toBe("text");
    expect(settingShape({ type: "string", enum: ["a"] })).toBe("choice");
    expect(settingShape({ type: "boolean" })).toBe("yesno");
  });

  it("tidies a typed time into hours, minutes and seconds", () => {
    expect(tidyTime("90")).toBe("00:01:30");
    expect(tidyTime("1:30")).toBe("00:01:30");
    expect(tidyTime(" 1:02:03.5 ")).toBe("01:02:03.5");
    expect(tidyTime("00:00:05")).toBe("00:00:05");
    expect(tidyTime("soon")).toBe("soon");
    expect(tidyTime("")).toBe("");
  });

  it("leaves blank rows and blank settings out of what is saved", () => {
    expect(
      tidySetting(range, [{ start: "00:00:05", end: "00:00:09" }, { start: "", end: "" }, {}]),
    ).toEqual([{ start: "00:00:05", end: "00:00:09" }]);
    expect(tidySetting(range, [{}])).toBeUndefined();
    expect(
      tidySetting(
        {
          type: "object",
          properties: {
            all_caps: { type: "boolean" },
            font_size: { type: "integer" },
            line_color: { type: "string" },
            position: { type: "string", enum: ["top", "bottom"] },
          },
        },
        { all_caps: "true", font_size: "48", line_color: "", position: "" },
      ),
    ).toEqual({ all_caps: true, font_size: 48 });
    expect(
      tidySetting({ type: "object", additionalProperties: { type: "string" } }, [
        ["Authorization", "abc"],
        ["", "x"],
      ]),
    ).toEqual({ Authorization: "abc" });
  });

  it("says what a half-filled row still needs", () => {
    expect(missingInRows(range, [{ start: "00:00:05" }, {}])).toEqual(["end"]);
    expect(missingInRows(range, [{ start: "00:00:05", end: "00:00:09" }])).toEqual([]);
  });
});
