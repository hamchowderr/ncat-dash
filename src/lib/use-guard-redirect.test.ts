import { describe, expect, test } from "vitest";

import { signInBackTo } from "./use-guard-redirect";

describe("after being signed out", () => {
  test("signing in again returns to the page you were on", () => {
    expect(signInBackTo({ pathname: "/runs/r1", search: "?tab=steps" })).toBe(
      "/sign-in?redirectTo=%2Fruns%2Fr1%3Ftab%3Dsteps",
    );
  });

  test("from Home or a sign-in screen, it just signs you in", () => {
    expect(signInBackTo({ pathname: "/", search: "" })).toBe("/sign-in");
    expect(signInBackTo({ pathname: "/sign-out", search: "" })).toBe("/sign-in");
  });
});
