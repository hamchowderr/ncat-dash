import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { CompareStage } from "./compare-stage";

const VIDEOS = [
  { url: "https://files.example/b.mp4" },
  { url: "https://files.example/b-v2.mp4" },
  { url: "https://files.example/b-v3.mp4" },
];

const sideVideo = (container: HTMLElement, side: "left" | "right") =>
  container.querySelector<HTMLVideoElement>(`[data-compare-side=${side}] video`)!;

describe("comparing two versions", () => {
  test("puts the version on screen on the right and the one before it on the left", () => {
    const { container } = render(
      <CompareStage title="Opening hello" versions={VIDEOS} initial={3} onClose={() => {}} />,
    );
    expect(sideVideo(container, "left")).toHaveAttribute("src", VIDEOS[1].url);
    expect(sideVideo(container, "right")).toHaveAttribute("src", VIDEOS[2].url);
    expect(screen.getByRole("combobox", { name: "Version on the left" })).toHaveValue("2");
    expect(screen.getByRole("combobox", { name: "Version on the right" })).toHaveValue("3");
  });

  test("starting from the first version still compares two different ones", () => {
    const { container } = render(
      <CompareStage title="Opening hello" versions={VIDEOS} initial={1} onClose={() => {}} />,
    );
    expect(sideVideo(container, "left")).toHaveAttribute("src", VIDEOS[0].url);
    expect(sideVideo(container, "right")).toHaveAttribute("src", VIDEOS[1].url);
  });

  test("any version can go on either side", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CompareStage title="Opening hello" versions={VIDEOS} initial={3} onClose={() => {}} />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Version on the left" }), "1");
    expect(sideVideo(container, "left")).toHaveAttribute("src", VIDEOS[0].url);
  });

  test("plays, pauses and seeks both sides together, with sound from one side", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container } = render(
      <CompareStage title="Opening hello" versions={VIDEOS} initial={2} onClose={() => {}} />,
    );
    const left = sideVideo(container, "left");
    const right = sideVideo(container, "right");
    expect(left.muted).toBe(true);
    expect(right.muted).toBe(false);

    await user.click(screen.getByRole("button", { name: "Play both" }));
    expect(play).toHaveBeenCalledTimes(2);
    pause.mockClear();
    await user.click(screen.getByRole("button", { name: "Pause both" }));
    expect(pause).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByRole("slider", { name: "Position in both versions" }), {
      target: { value: "0" },
    });
    expect(left.currentTime).toBe(0);
    expect(right.currentTime).toBe(0);

    await user.click(screen.getAllByRole("button", { name: "Play the sound from this side" })[0]);
    expect(left.muted).toBe(false);
    expect(right.muted).toBe(true);
  });

  test("thumbnails compare side by side with nothing to play", () => {
    render(
      <CompareStage
        title="Episode cover"
        versions={[{ url: "https://files.example/t.png" }, { url: "https://files.example/t2.png" }]}
        initial={2}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("img", { name: "Version 1" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Version 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play both" })).not.toBeInTheDocument();
  });

  test("done comparing goes back to the version on the right", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CompareStage title="Opening hello" versions={VIDEOS} initial={2} onClose={onClose} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Version on the right" }), "3");
    await user.click(screen.getByRole("button", { name: "Done comparing" }));
    expect(onClose).toHaveBeenCalledWith(3);
  });
});
