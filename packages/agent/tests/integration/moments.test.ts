import { afterEach, describe, expect, it, vi } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { clockTime, momentsPrompt, momentsRequest } from "../../src/mastra/ncat/moments";
import { useTeamKeysForTests } from "../../src/mastra/ncat/team-key";
import { ctx, find } from "../helpers/route-harness";

/**
 * POST /ncat/moments: the dashboard's Best moments and Chapters steps send a transcript and
 * get back the model's picks as text. The model is the stand-in (AIMock); its answers are
 * near the top of fixtures/chat.json.
 */

const route = find(createNcatRoutes(), "/ncat/moments", "POST");

const MOMENTS = {
  kind: "moments",
  title: "Pricing talk",
  duration: 125,
  transcript: "[0:00] Hello and welcome.\n[0:04] The one rule I keep for every client call.",
  settings: {
    count: 2,
    minSeconds: 15,
    maxSeconds: 60,
    platform: "TikTok",
    topics: "pricing",
    lookFor: "A tip that stands on its own",
  },
  avoid: [{ start: 30, end: 52 }],
  houseRules: "Never pick swearing.",
};

const CHAPTERS = {
  kind: "chapters",
  title: "Episode 12",
  duration: 3725,
  transcript: "[0:02] Welcome to the chapters test episode.",
  settings: { count: 0, bullets: 2 },
};

describe("the agent picking moments for the dashboard", () => {
  it("answers with the model's picks", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: MOMENTS });
    await route.handler(c);
    expect(captured.status).toBe(200);
    const answer = JSON.parse((captured.body as { answer: string }).answer) as {
      moments: { quote: string }[];
    };
    expect(answer.moments[0].quote).toBe("The one rule I keep for every client call.");
  });

  it("answers for chapters too, as the model wrote it", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: CHAPTERS });
    await route.handler(c);
    expect(captured.status).toBe(200);
    expect((captured.body as { answer: string }).answer).toContain('"opening"');
  });

  it("asks on the team's own Anthropic key when the team has one", async () => {
    useTeamKeysForTests(async (team) => (team === "team_1" ? "sk-ant-team-one" : null));
    const keys: (string | null)[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("x-api-key"));
      return real(input, init);
    });
    try {
      const team = ctx({
        resourceId: "automation",
        body: { ...MOMENTS, organizationId: "team_1" },
      });
      await route.handler(team.c);
      expect(team.captured.status).toBe(200);
      const other = ctx({
        resourceId: "automation",
        body: { ...MOMENTS, organizationId: "team_2" },
      });
      await route.handler(other.c);
      expect(other.captured.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      useTeamKeysForTests();
    }
    expect(keys.filter(Boolean)).toEqual(["sk-ant-team-one", "mock"]);
  });

  it("only answers a signed request", async () => {
    const { c, captured } = ctx({ body: MOMENTS });
    await route.handler(c);
    expect(captured.status).toBe(401);
  });

  it("refuses a request with no transcript", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: { ...MOMENTS, transcript: "" } });
    await route.handler(c);
    expect(captured.status).toBe(400);
  });
});

describe("the moments prompt", () => {
  it("asks for a few spare moments and passes on the team's settings", () => {
    const prompt = momentsPrompt(momentsRequest.parse(MOMENTS));
    expect(prompt).toContain('The recording: "Pricing talk", 2:05 long.');
    expect(prompt).toContain("Never pick swearing.");
    expect(prompt).toContain("Pick up to 5 moments to post as clips on TikTok, best first.");
    expect(prompt).toContain("The team will use the best 2.");
    expect(prompt).toContain("Each moment runs 15 to 60 seconds");
    expect(prompt).toContain("Favour these subjects: pricing");
    expect(prompt).toContain(
      "What makes a good moment for this team: A tip that stands on its own",
    );
    expect(prompt).toContain("pick nothing that overlaps them: 0:30 to 0:52.");
    expect(prompt.endsWith(MOMENTS.transcript)).toBe(true);
  });

  it("leaves out what the team did not set", () => {
    const prompt = momentsPrompt(
      momentsRequest.parse({
        ...MOMENTS,
        houseRules: "",
        avoid: [],
        settings: { ...MOMENTS.settings, topics: "", lookFor: "" },
      }),
    );
    expect(prompt).not.toContain("house rules");
    expect(prompt).not.toContain("Favour");
    expect(prompt).not.toContain("overlaps them");
  });

  it("lets the model decide how many chapters when none is set", () => {
    const prompt = momentsPrompt(momentsRequest.parse(CHAPTERS));
    expect(prompt).toContain("1:02:05 long");
    expect(prompt).toContain("as many as its topics need");
    expect(prompt).toContain("and 2 short bullets of show notes");
    const capped = momentsPrompt(
      momentsRequest.parse({ ...CHAPTERS, settings: { count: 8, bullets: 0 } }),
    );
    expect(capped).toContain("at most 8 chapters");
    expect(capped).not.toContain("bullets of show notes");
  });

  it("plans B-Roll with the gap, the opening and what to favour", () => {
    const prompt = momentsPrompt(
      momentsRequest.parse({
        kind: "broll",
        title: "Shop story",
        duration: 300,
        transcript: "[0:00] I started in my dad's garage.",
        settings: { count: 12, gap: 7, skipOpening: 3, lookFor: "the product" },
      }),
    );
    expect(prompt).toContain("up to 12 short cutaways");
    expect(prompt).toContain("No cutaway in the first 3 seconds. Keep at least 7 seconds between");
    expect(prompt).toContain("What the cutaways should favour: the product");
    expect(prompt).toContain('{"cutaways":[{"quote":"…","show":"…"}]}');
    expect(
      momentsRequest.safeParse({
        kind: "broll",
        duration: 1,
        transcript: "x",
        settings: { count: 0, gap: 1, skipOpening: 0 },
      }).success,
    ).toBe(false);
  });

  it("writes times as minutes and seconds", () => {
    expect(clockTime(0)).toBe("0:00");
    expect(clockTime(65.9)).toBe("1:05");
    expect(clockTime(3723)).toBe("1:02:03");
  });
});
