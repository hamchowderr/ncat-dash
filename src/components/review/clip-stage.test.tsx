import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, test, vi } from "vitest";

import { ClipStage, isStill, type Mark } from "./clip-stage";

const MARKS: Mark[] = [
  { id: "a", time: 2, authorId: "u1", authorName: "Maya Ortiz", resolved: false },
  { id: "b", time: 6, authorId: "u2", authorName: "Dev Patel", resolved: true },
];

function setup(over: Partial<Parameters<typeof ClipStage>[0]> = {}) {
  const video = createRef<HTMLVideoElement>();
  const handlers = {
    onTime: vi.fn(),
    onDuration: vi.fn(),
    onPlaying: vi.fn(),
    onSeek: vi.fn(),
    onMark: vi.fn(),
  };
  const view = render(
    <ClipStage
      url="https://files.example/clip.mp4"
      video={video}
      time={2}
      duration={8}
      playing={false}
      marks={MARKS}
      activeMark={null}
      header={<h2>Clip 1 of 1</h2>}
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, video, view, user: userEvent.setup() };
}

describe("the clip and its timeline", () => {
  test("knows a still picture from something to play", () => {
    expect(isStill("https://files.example/frame.PNG?x=1")).toBe(true);
    expect(isStill("https://files.example/clip.mp4")).toBe(false);
    expect(isStill("https://files.example/voice.mp3")).toBe(false);
  });

  test("the play button plays and pauses the clip", async () => {
    const { video, onPlaying, user, view } = setup();
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(video.current?.paused).toBe(false);
    expect(onPlaying).toHaveBeenLastCalledWith(true);

    view.rerender(
      <ClipStage
        url="https://files.example/clip.mp4"
        video={video}
        time={2}
        duration={8}
        playing
        marks={[]}
        activeMark={null}
        header={null}
        onTime={vi.fn()}
        onDuration={vi.fn()}
        onPlaying={onPlaying}
        onSeek={vi.fn()}
        onMark={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(video.current?.paused).toBe(true);
    expect(onPlaying).toHaveBeenLastCalledWith(false);
  });

  test("shows where the clip is and how long it runs", () => {
    setup({ time: 65, duration: 130 });
    expect(screen.getByText("1:05 / 2:10")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Position in the clip" });
    expect(slider).toHaveAttribute("aria-valuetext", "1:05 of 2:10");
    expect(slider).toHaveValue("65");
  });

  test("dragging the timeline seeks", () => {
    const { onSeek } = setup();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "5.5" } });
    expect(onSeek).toHaveBeenCalledWith(5.5);
  });

  test("reports the clip's progress and length as it plays", () => {
    const { onTime, onDuration, video } = setup();
    Object.defineProperty(video.current!, "currentTime", { value: 3.2, configurable: true });
    Object.defineProperty(video.current!, "duration", { value: 8, configurable: true });
    fireEvent.timeUpdate(video.current!);
    fireEvent.loadedMetadata(video.current!);
    expect(onTime).toHaveBeenCalledWith(3.2);
    expect(onDuration).toHaveBeenCalledWith(8);
  });

  test("puts each comment's face at its moment, and pressing one reports it", async () => {
    const { onMark, user } = setup();
    const first = screen.getByRole("button", { name: "Maya Ortiz's comment at 0:02" });
    const second = screen.getByRole("button", { name: "Dev Patel's comment at 0:06" });
    expect(first).toHaveStyle({ left: "25%" });
    expect(second).toHaveStyle({ left: "75%" });
    expect(second).toHaveClass("opacity-45");
    await user.click(first);
    expect(onMark).toHaveBeenCalledWith(MARKS[0]);
  });

  test("faces wait until the clip's length is known", () => {
    setup({ duration: 0 });
    expect(screen.queryByRole("button", { name: /comment at/ })).not.toBeInTheDocument();
  });

  test("a still picture is shown without a player", () => {
    const { view } = setup({ url: "https://files.example/frame.png" });
    expect(view.container.querySelector("img")).toHaveAttribute(
      "src",
      "https://files.example/frame.png",
    );
    expect(view.container.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
