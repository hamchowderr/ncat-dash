import { afterEach, describe, expect, it, vi } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import {
  clockTime,
  dashboardUsage,
  momentsMessage,
  momentsParts,
  momentsPrompt,
  momentsRequest,
  pickModel,
} from "../../src/mastra/ncat/moments";
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

  it("says which model answered and what it used, for the run's AI limit", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: MOMENTS });
    await route.handler(c);
    const body = captured.body as { model: string; usage: Record<string, number> };
    expect(typeof body.model).toBe("string");
    expect(Object.keys(body.usage).sort()).toEqual([
      "cacheReadTokens",
      "cacheWriteTokens",
      "inputTokens",
      "outputTokens",
    ]);
    for (const value of Object.values(body.usage)) expect(value).toBeGreaterThanOrEqual(0);
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

describe("what an answer used, as the dashboard reads it", () => {
  it("reads older AI SDK usage, with cache reads beside the input", () => {
    expect(dashboardUsage({ inputTokens: 900, outputTokens: 40, cachedInputTokens: 100 })).toEqual({
      inputTokens: 900,
      outputTokens: 40,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    });
  });

  it("reads newer AI SDK usage, where input includes the cache", () => {
    expect(
      dashboardUsage({
        inputTokens: 1000,
        outputTokens: 40,
        inputTokenDetails: { noCacheTokens: 700, cacheReadTokens: 200, cacheWriteTokens: 100 },
      }),
    ).toEqual({ inputTokens: 700, outputTokens: 40, cacheReadTokens: 200, cacheWriteTokens: 100 });
  });

  it("takes the cache write from Anthropic's own numbers when the SDK leaves it out", () => {
    expect(
      dashboardUsage({ inputTokens: 500 }, { anthropic: { cacheCreationInputTokens: 300 } }),
    ).toEqual({ inputTokens: 500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 300 });
  });

  it("counts nothing for missing usage", () => {
    expect(dashboardUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
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
    // Marked by first and last words: a long transcript made models quote only a clip's
    // opening line, which came out seconds long.
    expect(prompt).toContain('{"moments":[{"start":"…","end":"…","title":"…","why":"…"}]}');
    expect(prompt).toContain("not after its first sentence");
    // The recording and transcript come first, so they can be cached across questions.
    expect(prompt.startsWith(`The recording: "Pricing talk", 2:05 long.\n\nThe transcript:\n${MOMENTS.transcript}`)).toBe(true);
  });

  it("caches the recording and its transcript apart from the question", () => {
    const request = momentsRequest.parse(MOMENTS);
    const { recording, ask } = momentsParts(request);
    expect(recording).toContain(MOMENTS.transcript);
    expect(ask).not.toContain(MOMENTS.transcript);
    // The same recording asked with other settings is the same cached part.
    const other = momentsParts(
      momentsRequest.parse({ ...MOMENTS, settings: { ...MOMENTS.settings, count: 5 } }),
    );
    expect(other.recording).toBe(recording);
    expect(other.ask).not.toBe(ask);
    const message = momentsMessage(request);
    expect(message.content[0]?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect(message.content[1]).not.toHaveProperty("providerOptions");
  });

  it("picks on the team's Claude model when the server allows it, else its own", () => {
    const allowed = new Set(["anthropic/claude-opus-5-5", "openai/gpt-4.1-mini"]);
    expect(pickModel("anthropic/claude-opus-5-5", allowed)).toBe("anthropic/claude-opus-5-5");
    expect(pickModel("openai/gpt-4.1-mini", allowed)).not.toBe("openai/gpt-4.1-mini");
    expect(pickModel("anthropic/claude-made-up", allowed)).not.toBe("anthropic/claude-made-up");
    expect(pickModel(undefined, allowed)).toBe(pickModel("", allowed));
  });

  it("passes on the video's own brief after the house rules", () => {
    for (const asked of [MOMENTS, CHAPTERS]) {
      const prompt = momentsPrompt(
        momentsRequest.parse({ ...asked, brief: "Fast pacing. Keep the pricing story whole." }),
      );
      expect(prompt).toContain(
        "The brief for this video (pacing and direction from the team; follow it where it applies):\nFast pacing. Keep the pricing story whole.",
      );
    }
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
    expect(prompt).not.toContain("brief");
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

  it("plans motion graphics with the style's pieces, gap, sounds and notes", () => {
    const motion = {
      kind: "motion",
      title: "Growth talk",
      duration: 120,
      transcript: "[0:00] We grew revenue 40 percent.",
      settings: {
        count: 10,
        gap: 12,
        pieces: ["keyword", "stat"],
        showsUnsaid: false,
        sounds: true,
        look: "bold",
        notes: "Never use red.",
        lookFor: "the numbers",
      },
    };
    const prompt = momentsPrompt(momentsRequest.parse(motion));
    expect(prompt).toContain("up to 10 beats");
    expect(prompt).toContain("- keyword:");
    expect(prompt).toContain("- stat:");
    expect(prompt).not.toContain("- quote:");
    expect(prompt).toContain("Keep at least 12 seconds between two beats");
    expect(prompt).toContain("A keyword uses only words said in its quote.");
    expect(prompt).toContain("Give each beat the sound it comes in with");
    expect(prompt).toContain("Never use red.");
    expect(prompt).toContain("What the graphics should bring out: the numbers");
    expect(prompt).toContain(
      '{"beats":[{"quote":"…","piece":"…","text":"…","subtitle":"…","sound":"…"}]}',
    );
    const quiet = momentsPrompt(
      momentsRequest.parse({
        ...motion,
        settings: { ...motion.settings, sounds: false, showsUnsaid: true, notes: "", lookFor: "" },
      }),
    );
    expect(quiet).not.toContain("Give each beat the sound");
    expect(quiet).toContain("in your own words");
    expect(
      momentsRequest.safeParse({
        ...motion,
        settings: { ...motion.settings, pieces: ["follow"] },
      }).success,
    ).toBe(false);
  });

  it("writes times as minutes and seconds", () => {
    expect(clockTime(0)).toBe("0:00");
    expect(clockTime(65.9)).toBe("1:05");
    expect(clockTime(3723)).toBe("1:02:03");
  });
});
