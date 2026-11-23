import { afterEach, describe, expect, test } from "vitest";

import { onOperatorToolkit } from "./lib/edition";

afterEach(() => {
  delete process.env.NCAT_EDITION;
  delete process.env.HOSTED_TOOLKIT_URL;
});

// Whose toolkit a team is on decides whether its load is shown and whether the shared
// fair cap applies.
describe("whose toolkit it is", () => {
  test("the lent toolkit is ours, whatever path the team saved", () => {
    process.env.HOSTED_TOOLKIT_URL = "https://media.example/";
    expect(onOperatorToolkit("https://media.example")).toBe(true);
    expect(onOperatorToolkit("https://MEDIA.example/v1")).toBe(true);
  });

  test("a hosted team on its own toolkit looks after it itself", () => {
    process.env.NCAT_EDITION = "hosted";
    process.env.HOSTED_TOOLKIT_URL = "https://media.example";
    expect(onOperatorToolkit("https://toolkit.theirs.example")).toBe(false);
  });

  test("on the hosted edition with no lent address, every toolkit counts as ours", () => {
    process.env.NCAT_EDITION = "hosted";
    expect(onOperatorToolkit("https://toolkit.theirs.example")).toBe(true);
  });

  test("on a self-hosted copy that lends none, the team's toolkit is its own", () => {
    expect(onOperatorToolkit("https://toolkit.example")).toBe(false);
    expect(onOperatorToolkit(null)).toBe(false);
  });
});
