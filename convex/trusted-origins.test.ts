import { describe, expect, test } from "vitest";

import { trustedOrigins } from "./auth";

describe("the addresses allowed to sign in", () => {
  test("are the dashboard's own address when nothing else is set", () => {
    expect(trustedOrigins({ SITE_URL: "https://dash.example.test/" })).toEqual([
      "https://dash.example.test",
    ]);
  });

  test("add the ones listed in TRUSTED_ORIGINS, such as every Vercel preview", () => {
    expect(
      trustedOrigins({
        SITE_URL: "https://dash.example.test",
        TRUSTED_ORIGINS:
          " https://dash-preview-*-team.vercel.app , https://dash.example.test,, https://other.test/ ",
      }),
    ).toEqual([
      "https://dash.example.test",
      "https://dash-preview-*-team.vercel.app",
      "https://other.test",
    ]);
  });

  test("are empty rather than broken when nothing is set", () => {
    expect(trustedOrigins({})).toEqual([]);
  });
});
