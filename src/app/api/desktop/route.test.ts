import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("the address check the desktop app makes", () => {
  test("answers which app this is", async () => {
    const reply = GET();
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ app: "ncat-dash" });
  });
});
