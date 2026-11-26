import { afterEach, describe, expect, it, vi } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { finishSignIn, startSignIn, useFirecrawlForTests } from "../../src/mastra/ncat/sign-ins";
import { ctx, find } from "../helpers/route-harness";

/**
 * Saved sign-ins for page recordings: the person signs in themselves in a Firecrawl
 * browser they drive from a new tab, and ending that session saves it as the team's
 * profile. Firecrawl is a stand-in here.
 */

function stand(over: { liveView?: boolean; closeFails?: boolean } = {}) {
  const calls = {
    browser: vi.fn(async (_options: unknown) => ({
      success: true,
      id: "session_1",
      interactiveLiveViewUrl: over.liveView === false ? undefined : "https://live.example.com/s1",
      expiresAt: "2026-11-26T10:15:00Z",
    })),
    browserExecute: vi.fn(async (_id: string, _code: unknown) => ({ success: true })),
    deleteBrowser: vi.fn(async (_id: string) =>
      over.closeFails ? { success: false, error: "gone" } : { success: true },
    ),
  };
  useFirecrawlForTests(() => calls as never);
  return calls;
}

afterEach(() => useFirecrawlForTests());

describe("saving a sign-in", () => {
  it("opens a browser that saves into the team's profile, on the sign-in page", async () => {
    const calls = stand();
    const started = await startSignIn({
      organizationId: "team_1",
      profile: "takewon-team_1-s1",
      url: "https://app.example.com/login",
    });
    expect(started).toEqual({
      sessionId: "session_1",
      liveViewUrl: "https://live.example.com/s1",
      expiresAt: "2026-11-26T10:15:00Z",
    });
    expect(calls.browser.mock.calls[0][0]).toMatchObject({
      profile: { name: "takewon-team_1-s1", saveChanges: true },
    });
    expect(JSON.stringify(calls.browserExecute.mock.calls[0][1])).toContain(
      "https://app.example.com/login",
    );
  });

  it("closes a browser it cannot hand over, and says why", async () => {
    const calls = stand({ liveView: false });
    await expect(
      startSignIn({ organizationId: "t", profile: "p", url: "https://app.example.com" }),
    ).rejects.toThrow(/did not open a browser/);
    expect(calls.deleteBrowser).toHaveBeenCalledWith("session_1");
  });

  it("ends the session to save it, and reports when Firecrawl would not", async () => {
    const calls = stand();
    await finishSignIn({ sessionId: "session_1" });
    expect(calls.deleteBrowser).toHaveBeenCalledWith("session_1");
    stand({ closeFails: true });
    await expect(finishSignIn({ sessionId: "session_1" })).rejects.toThrow("gone");
  });
});

describe("the sign-in routes", () => {
  const start = find(createNcatRoutes(), "/ncat/sign-in/start", "POST");
  const finish = find(createNcatRoutes(), "/ncat/sign-in/finish", "POST");

  it("refuse unsigned calls and profile names Firecrawl would not take", async () => {
    const unsigned = ctx({ body: { sessionId: "s" } });
    await finish.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({
      resourceId: "u1",
      body: { organizationId: "t", profile: "has spaces", url: "https://example.com" },
    });
    await start.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });

  it("answer the live view link, then save", async () => {
    stand();
    const started = ctx({
      resourceId: "u1",
      body: { organizationId: "t", profile: "takewon-t-1", url: "https://example.com/login" },
    });
    await start.handler(started.c);
    expect(started.captured.body).toMatchObject({ liveViewUrl: "https://live.example.com/s1" });
    const finished = ctx({ resourceId: "u1", body: { sessionId: "session_1" } });
    await finish.handler(finished.c);
    expect(finished.captured.body).toEqual({ ok: true });
  });
});
