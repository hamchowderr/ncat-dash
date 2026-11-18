import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "@convex/_generated/api";
import { useVoiceNote } from "@/components/agent/use-voice-note";
import { TeamContext } from "@/lib/team-context";
import { actionOf } from "@/test/convex";

import { Composer } from "./composer";

// A voice note to the agent: the microphone records (in every browser that can), the
// recording becomes words, and the words are sent as the message.

class FakeRecorder extends EventTarget {
  static last: FakeRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/mp4";
  constructor() {
    super();
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    const chunk = new Event("dataavailable") as Event & { data: Blob };
    chunk.data = new Blob(["spoken bytes"], { type: "audio/mp4" });
    this.dispatchEvent(chunk);
    this.dispatchEvent(new Event("stop"));
  }
}

const stopTrack = vi.fn();
beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error put back as jsdom has it
  delete navigator.mediaDevices;
});

async function recordAndStop() {
  const mic = await screen.findByRole("button", { name: "Record a voice note" });
  await act(async () => fireEvent.click(mic));
  expect(mic).toHaveAttribute("data-state", "recording");
  await act(async () => fireEvent.click(mic));
  return mic;
}

describe("the voice note button", () => {
  test("records, and sends the words as the message", async () => {
    const onSend = vi.fn(async (_submit: unknown) => undefined);
    const voiceNote = vi.fn(async (audio: Blob) => {
      expect(audio.type).toBe("audio/mp4");
      return "Make clips from every new episode";
    });
    render(<Composer onSend={onSend} voiceNote={voiceNote} models={false} webSearch={false} />);
    await recordAndStop();
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0][0]).toMatchObject({ text: "Make clips from every new episode" });
    expect(stopTrack).toHaveBeenCalled();
  });

  test("sends what was already typed first", async () => {
    const onSend = vi.fn(async (_submit: unknown) => undefined);
    render(
      <Composer onSend={onSend} voiceNote={async () => "and switch it on"} models={false} webSearch={false} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Build the podcast clips" },
    });
    await recordAndStop();
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0][0]).toMatchObject({ text: "Build the podcast clips\n\nand switch it on" });
  });

  test("says why when the note could not be turned into words, and sends nothing", async () => {
    const onSend = vi.fn();
    render(
      <Composer
        onSend={onSend}
        voiceNote={async () => {
          throw new Error("Connect your toolkit first: it is what turns voice notes into words.");
        }}
        models={false}
        webSearch={false}
      />,
    );
    await recordAndStop();
    expect(await screen.findByRole("alert")).toHaveTextContent("Connect your toolkit first");
    expect(onSend).not.toHaveBeenCalled();
  });

  test("is not shown where the browser cannot record", async () => {
    vi.unstubAllGlobals();
    // @ts-expect-error no recorder in this browser
    delete globalThis.MediaRecorder;
    render(<Composer onSend={vi.fn()} voiceNote={async () => "x"} models={false} webSearch={false} />);
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "Record a voice note" })).toBeNull();
  });
});

describe("turning a voice note into words", () => {
  const team = { id: "team_1", name: "Salt House", slug: "salt-house", role: "owner" };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TeamContext.Provider value={team as never}>{children}</TeamContext.Provider>
  );

  test("sends the recording to the team's storage, then asks the toolkit for the words", async () => {
    actionOf(api.voiceNotes.start).mockResolvedValue({
      key: "voice-notes/abc.m4a",
      uploadUrl: "https://r2.example/put-here",
    });
    actionOf(api.voiceNotes.transcribe).mockResolvedValue({ text: "hello there" });
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    const { result } = renderHook(() => useVoiceNote(), { wrapper });
    const audio = new Blob(["x".repeat(10)], { type: "audio/mp4" });
    await expect(result.current(audio)).resolves.toBe("hello there");
    expect(actionOf(api.voiceNotes.start)).toHaveBeenCalledWith({
      organizationId: "team_1",
      contentType: "audio/mp4",
      size: 10,
    });
    expect(put).toHaveBeenCalledWith("https://r2.example/put-here", expect.objectContaining({ method: "PUT" }));
    expect(actionOf(api.voiceNotes.transcribe)).toHaveBeenCalledWith({
      organizationId: "team_1",
      key: "voice-notes/abc.m4a",
    });
  });

  test("passes on the dashboard's reason, and says so when nothing was heard", async () => {
    actionOf(api.voiceNotes.start).mockRejectedValue({ data: { message: "Voice notes can be up to 25 MB." } });
    const { result } = renderHook(() => useVoiceNote(), { wrapper });
    await expect(result.current(new Blob(["x"], { type: "audio/webm" }))).rejects.toThrow(
      "Voice notes can be up to 25 MB.",
    );

    actionOf(api.voiceNotes.start).mockResolvedValue({ key: "k", uploadUrl: "https://r2.example/p" });
    actionOf(api.voiceNotes.transcribe).mockResolvedValue({ text: "" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    await expect(result.current(new Blob(["x"], { type: "audio/webm" }))).rejects.toThrow(
      /No words could be heard/,
    );
  });
});
