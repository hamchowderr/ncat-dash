import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";
import { isVoiceNoteKey, transcriptOf, voiceNoteExtension } from "./voiceNotes";

/**
 * Voice notes to the agent: put in the team's own folder, turned into words by the team's
 * own toolkit, then removed. Nobody can read a key outside the voice-notes folder this way.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

async function studio({ transcribeStatus = 200, heard = "  Make clips\nfrom the new episode " } = {}) {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const storageFetch = globalThis.fetch;
  const transcribed: Record<string, unknown>[] = [];
  const puts: { url: string; type: string | null; size: number }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/v1/media/transcribe") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      transcribed.push(body);
      return new Response(
        JSON.stringify(
          transcribeStatus === 200
            ? { code: 200, response: { text: heard, srt: null, segments: null } }
            : { code: transcribeStatus, message: "boom" },
        ),
        { status: transcribeStatus },
      );
    }
    if (url.origin === "https://r2.example" && init?.method === "PUT") {
      const size = (init.body as ArrayBuffer).byteLength;
      puts.push({ url: url.toString(), type: new Headers(init.headers).get("content-type"), size });
      return new Response(null, { status: 200 });
    }
    return storageFetch(input, init);
  });
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const member = await addPerson(t, "Jo Park", [team], "member");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  await connectToolkit(t, team, owner.id);
  return { t, team, owner, member, outsider, transcribed, puts, toolkit };
}

describe("what a voice note is", () => {
  test("recordings from browsers, Slack and Discord get their own file ending", () => {
    expect(voiceNoteExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(voiceNoteExtension("audio/ogg")).toBe("ogg");
    expect(voiceNoteExtension("audio/mp4")).toBe("m4a");
    expect(voiceNoteExtension("AUDIO/MPEG")).toBe("mp3");
    expect(voiceNoteExtension("image/png")).toBeNull();
  });

  test("only keys in the voice-notes folder count", () => {
    expect(isVoiceNoteKey("voice-notes/0b0f0a9e-2b8c-4f0d-9a43-1e2f3a4b5c6d.webm")).toBe(true);
    expect(isVoiceNoteKey("uploads/0b0f0a9e-2b8c-4f0d-9a43-1e2f3a4b5c6d/episode.mp4")).toBe(false);
    expect(isVoiceNoteKey("voice-notes/../uploads/a.webm")).toBe(false);
  });

  test("the words are read from the toolkit's answer and tidied", () => {
    expect(transcriptOf({ response: { text: " a\n b  " } })).toBe("a b");
    expect(transcriptOf({ response: "nope" })).toBe("");
    expect(transcriptOf(null)).toBe("");
  });
});

describe("a voice note from the agent panel", () => {
  test("any member gets an upload link in the team's folder, then the words", async () => {
    const { team, member, transcribed, toolkit } = await studio();
    const { key, uploadUrl } = await member.as.action(api.voiceNotes.start, {
      organizationId: team,
      contentType: "audio/webm;codecs=opus",
      size: 48_000,
    });
    expect(isVoiceNoteKey(key)).toBe(true);
    expect(uploadUrl).toContain(`teams/${team}/${key}`);
    expect(uploadUrl).toContain("method=PUT");

    toolkit.put(`teams/${team}/${key}`, 48_000);
    const { text } = await member.as.action(api.voiceNotes.transcribe, { organizationId: team, key });
    expect(text).toBe("Make clips from the new episode");
    expect(transcribed).toHaveLength(1);
    expect(transcribed[0]).toMatchObject({ include_text: true, response_type: "direct" });
    expect(transcribed[0]).not.toHaveProperty("webhook_url");
    expect(String(transcribed[0].media_url)).toContain(`teams/${team}/${key}`);
    // The note is removed once its words are out.
    expect(toolkit.files.has(`teams/${team}/${key}`)).toBe(false);
  });

  test("something that is not audio, or too large, is refused", async () => {
    const { team, owner } = await studio();
    await expect(
      owner.as.action(api.voiceNotes.start, { organizationId: team, contentType: "video/x-flv", size: 10 }),
    ).rejects.toThrow(/not audio/);
    await expect(
      owner.as.action(api.voiceNotes.start, {
        organizationId: team,
        contentType: "audio/webm",
        size: 30 * 1024 * 1024,
      }),
    ).rejects.toThrow(/25 MB/);
  });

  test("only voice notes can be read, and only by the team", async () => {
    const { team, owner, outsider, transcribed } = await studio();
    await expect(
      owner.as.action(api.voiceNotes.transcribe, {
        organizationId: team,
        key: "uploads/0b0f0a9e-2b8c-4f0d-9a43-1e2f3a4b5c6d/episode.mp4",
      }),
    ).rejects.toThrow(/not there/);
    await expect(
      outsider.as.action(api.voiceNotes.start, { organizationId: team, contentType: "audio/webm", size: 10 }),
    ).rejects.toThrow();
    await expect(
      outsider.as.action(api.voiceNotes.transcribe, {
        organizationId: team,
        key: "voice-notes/0b0f0a9e-2b8c-4f0d-9a43-1e2f3a4b5c6d.webm",
      }),
    ).rejects.toThrow();
    expect(transcribed).toEqual([]);
  });

  test("a toolkit that fails says so in plain words, and the note is still removed", async () => {
    const { team, owner, toolkit } = await studio({ transcribeStatus: 500 });
    const { key } = await owner.as.action(api.voiceNotes.start, {
      organizationId: team,
      contentType: "audio/mp4",
      size: 1000,
    });
    toolkit.put(`teams/${team}/${key}`);
    await expect(
      owner.as.action(api.voiceNotes.transcribe, { organizationId: team, key }),
    ).rejects.toThrow(/could not turn the voice note into words \(HTTP 500\)/);
    expect(toolkit.files.has(`teams/${team}/${key}`)).toBe(false);
  });

  test("a team with no toolkit is told to connect one", async () => {
    process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
    const t = backend();
    const team = await addTeam(t, "No Toolkit");
    const owner = await addPerson(t, "Ana Lee", [team], "owner");
    await expect(
      owner.as.action(api.voiceNotes.start, { organizationId: team, contentType: "audio/webm", size: 10 }),
    ).rejects.toThrow(/Connect your toolkit/);
  });
});

describe("a voice note sent in Slack or Discord", () => {
  test("the bytes go to the team's folder, the toolkit hears them, the words come back", async () => {
    const { t, team, puts, transcribed } = await studio({ heard: "Switch on the podcast clips" });
    const audio = new TextEncoder().encode("ogg bytes").buffer;
    const { text } = await t.action(internal.voiceNotes.transcribeAudio, {
      organizationId: team,
      audio,
      contentType: "audio/ogg",
    });
    expect(text).toBe("Switch on the podcast clips");
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toMatch(new RegExp(`teams/${team}/voice-notes/[0-9a-f-]{36}\\.ogg`));
    expect(puts[0]).toMatchObject({ type: "audio/ogg", size: 9 });
    expect(transcribed).toHaveLength(1);
  });

  test("an empty or non-audio file is refused before anything is stored", async () => {
    const { t, team, puts } = await studio();
    await expect(
      t.action(internal.voiceNotes.transcribeAudio, {
        organizationId: team,
        audio: new ArrayBuffer(0),
        contentType: "audio/ogg",
      }),
    ).rejects.toThrow();
    await expect(
      t.action(internal.voiceNotes.transcribeAudio, {
        organizationId: team,
        audio: new ArrayBuffer(4),
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/not audio/);
    expect(puts).toEqual([]);
  });
});

describe("the agent server's address for voice notes", () => {
  const SECRET = "a-shared-secret-that-is-32-chars!!";
  async function agentToken(secret = SECRET) {
    const iat = Math.floor(Date.now() / 1000);
    const part = (value: string) => Buffer.from(value).toString("base64url");
    const body = `${part(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${part(
      JSON.stringify({ sub: "agent-server", iat, exp: iat + 300 }),
    )}`;
    const { createHmac } = await import("node:crypto");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  }

  test("answers the agent server with the words, and nobody else", async () => {
    process.env.MASTRA_JWT_SECRET = SECRET;
    const { t, team } = await studio({ heard: "Run it on yesterday's stream" });
    const send = async (authorization: string, query = `?organizationId=${team}`) =>
      await t.fetch(`/agent/voice-note${query}`, {
        method: "POST",
        headers: { authorization, "content-type": "audio/ogg" },
        body: new TextEncoder().encode("ogg bytes"),
      });

    expect((await send("Bearer nope")).status).toBe(401);
    expect((await send(`Bearer ${await agentToken("another-secret-of-32-characters!!")}`)).status).toBe(401);
    expect((await send(`Bearer ${await agentToken()}`, "")).status).toBe(400);

    const good = await send(`Bearer ${await agentToken()}`);
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ text: "Run it on yesterday's stream" });
    delete process.env.MASTRA_JWT_SECRET;
  });

  test("passes on why a note could not be read", async () => {
    process.env.MASTRA_JWT_SECRET = SECRET;
    const { t, team } = await studio();
    const refused = await t.fetch(`/agent/voice-note?organizationId=${team}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await agentToken()}`, "content-type": "text/plain" },
      body: "hello",
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: "That file is not audio." });
    delete process.env.MASTRA_JWT_SECRET;
  });
});
