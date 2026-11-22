import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";

import { WatchHowButton, WatchHowPanel } from "./watch-how";

function Page({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <>
      <WatchHowButton pathname={pathname} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <WatchHowPanel
          pathname={pathname}
          playing={playing}
          onPlay={setPlaying}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const video = () => document.querySelector("video");

describe("Watch how", () => {
  test("is left out on a page no video explains", () => {
    render(<Page pathname="/toolkit" />);
    expect(screen.queryByRole("button", { name: "Watch how" })).toBeNull();
  });

  test("plays the page's first video in the page, and closes", () => {
    render(<Page pathname="/jobs" />);
    const button = screen.getByRole("button", { name: "Watch how" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Watch how" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
    expect(video()?.getAttribute("src")).toBe("https://takewon.com/watch/26-jobs.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Close the video" }));
    expect(video()).toBeNull();
  });

  test("switches to another of the page's videos", () => {
    render(<Page pathname="/automations/abc/runs/xyz" />);
    fireEvent.click(screen.getByRole("button", { name: "Watch how" }));
    const list = screen.getByRole("list", { name: "More videos for this page" });
    fireEvent.click(list.querySelectorAll("button")[1]);
    expect(screen.getByRole("heading", { name: "A Backup Plan When A Step Fails" })).toBeTruthy();
    expect(video()?.getAttribute("src")).toBe(
      "https://takewon.com/watch/13-a-backup-plan-when-a-step-fails.mp4",
    );
  });

  test("a page with one video lists no others", () => {
    render(<Page pathname="/calendar" />);
    fireEvent.click(screen.getByRole("button", { name: "Watch how" }));
    expect(screen.queryByRole("list", { name: "More videos for this page" })).toBeNull();
  });
});
