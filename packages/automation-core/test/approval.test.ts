import { describe, expect, test } from "vitest";
import {
  approvalLimitMs,
  approvalProblem,
  approvalSentence,
  approvalSettings,
  approvalShort,
  askedToDecide,
  limitWords,
  mayDecide,
} from "../src";

const team = [
  { userId: "olu", name: "Olu", role: "owner" },
  { userId: "ana", name: "Ana", role: "member" },
  { userId: "ben", name: "Ben", role: "member" },
  { userId: "cy", name: "Cy", role: "member,admin" },
];
const nameOf = (id: string) => team.find((member) => member.userId === id)?.name;

describe("approval settings", () => {
  test("nothing set means anyone, no limit, and reject when time is up", () => {
    expect(approvalSettings({})).toEqual({ reviewers: [], limit: null, whenTimeUp: "reject" });
  });

  test("odd values are read as the defaults", () => {
    expect(
      approvalSettings({
        reviewers: ["ana", "", 4, "ana"],
        timeLimit: -2,
        timeLimitUnit: "weeks",
        whenTimeUp: "maybe",
      }),
    ).toEqual({ reviewers: ["ana"], limit: null, whenTimeUp: "reject" });
    expect(approvalSettings({ timeLimit: 3, timeLimitUnit: "weeks" }).limit).toEqual({
      amount: 3,
      unit: "hours",
    });
  });

  test("the time limit is capped at 6 days", () => {
    expect(approvalProblem({ timeLimit: 6, timeLimitUnit: "days" })).toBeNull();
    expect(approvalProblem({ timeLimit: 145, timeLimitUnit: "hours" })).toMatch(/6 days at most/);
    expect(approvalLimitMs({ timeLimit: 7, timeLimitUnit: "days" })).toBeNull();
    expect(approvalLimitMs({ timeLimit: 1.5, timeLimitUnit: "hours" })).toBe(5_400_000);
    expect(approvalLimitMs({})).toBeNull();
  });

  test("words for the canvas", () => {
    expect(limitWords({ amount: 1, unit: "days" })).toBe("1 day");
    expect(limitWords({ amount: 24, unit: "hours" })).toBe("24 hours");
    expect(approvalShort({})).toBe("Anyone on the team");
    expect(approvalShort({ reviewers: ["ana", "ben"], timeLimit: 2, timeLimitUnit: "days" })).toBe(
      "2 reviewers · 2 days",
    );
    expect(approvalSentence({}, nameOf)).toBe("Anyone on the team");
    expect(
      approvalSentence({ reviewers: ["ana"], timeLimit: 24, whenTimeUp: "approve" }, nameOf),
    ).toBe("Ana, approves after 24 hours");
    expect(approvalSentence({ reviewers: ["ana", "ben", "cy"] }, nameOf)).toBe("Ana or 2 others");
  });
});

describe("who decides", () => {
  test("nobody named asks the whole team", () => {
    expect(askedToDecide([], team)).toEqual(team);
    expect(mayDecide([], team, "ben")).toBe(true);
  });

  test("named reviewers, plus owners and admins", () => {
    expect(askedToDecide(["ana"], team).map((member) => member.userId)).toEqual(["ana"]);
    expect(mayDecide(["ana"], team, "ana")).toBe(true);
    expect(mayDecide(["ana"], team, "ben")).toBe(false);
    expect(mayDecide(["ana"], team, "olu")).toBe(true);
    expect(mayDecide(["ana"], team, "cy")).toBe(true);
  });

  test("when every named reviewer has left, the whole team is asked again", () => {
    expect(askedToDecide(["gone"], team)).toEqual(team);
    expect(mayDecide(["gone"], team, "ben")).toBe(true);
  });

  test("someone not on the team never decides", () => {
    expect(mayDecide([], team, "stranger")).toBe(false);
  });
});
