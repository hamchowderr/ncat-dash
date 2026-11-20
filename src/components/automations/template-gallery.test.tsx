import { STARTER_CATEGORIES, STARTERS } from "@ncat-dash/automation-core";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { TemplateGallery } from "./template-gallery";

const cards = () =>
  screen
    .getAllByRole("button")
    .filter((button) => STARTERS.some((starter) => button.textContent?.includes(starter.name)));

describe("the ready-made automations", () => {
  test("shows every one, sorted into categories, with nothing tucked away", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    for (const category of STARTER_CATEGORIES) {
      expect(screen.getByRole("heading", { name: new RegExp(`^${category.label}`) })).toBeTruthy();
    }
    for (const starter of STARTERS) {
      expect(screen.getAllByText(starter.name, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: /^All 83$/ })).toBeTruthy();
  });

  test("narrows to one category", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Music \d+$/ }));
    expect(screen.getByRole("button", { name: /^Music/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Lyric video with highlighted words")).toBeTruthy();
    expect(screen.queryByText("Clips for social")).toBeNull();
  });

  test("finds one by words in its name or description", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Find a ready-made automation"), {
      target: { value: "podcast" },
    });
    expect(screen.getByText("Podcast master and transcript")).toBeTruthy();
    expect(screen.queryByText("Add a logo")).toBeNull();
    fireEvent.change(screen.getByLabelText("Find a ready-made automation"), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText(/Nothing ready-made matches that/)).toBeTruthy();
    expect(cards()).toHaveLength(0);
  });

  test("names each card by its own ready-made, with what it follows as its description", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    // Ready To Post runs after this one, but only the one card is named by it.
    expect(
      screen.getAllByRole("button", { name: /Vertical and captioned from a watched folder/ }),
    ).toHaveLength(1);
    const readyToPost = screen.getByRole("button", { name: /Ready To Post/ });
    expect(readyToPost.getAttribute("aria-describedby")).toBeTruthy();
    expect(readyToPost).toHaveAccessibleDescription(/^Runs after .*Brand Every Clip/);
  });

  test("picks one, or an empty canvas", () => {
    const onPick = vi.fn();
    renderInApp(<TemplateGallery onPick={onPick} />);
    const music = screen.getByRole("region", { name: /^Music/ });
    fireEvent.click(within(music).getByText("Music release pack"));
    expect(onPick).toHaveBeenCalledWith(STARTERS.find((s) => s.id === "music-release-pack"));
    fireEvent.click(screen.getByText("Empty canvas"));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  test("lists the follow-the-speaker automations under Clips and shapes", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    const clips = screen.getByRole("region", { name: /^Clips and shapes/ });
    expect(within(clips).getByText("Clips that follow the speaker")).toBeTruthy();
    expect(within(clips).getByText("Vertical that follows the speaker")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find a ready-made automation"), {
      target: { value: "speaker" },
    });
    expect(cards().map((card) => card.textContent)).toEqual([
      expect.stringContaining("Clips that follow the speaker"),
      expect.stringContaining("Vertical that follows the speaker"),
      // Its backup is found too, under After another automation.
      expect.stringContaining("Backup When Following The Speaker Fails"),
      expect.stringContaining("Backup When Clips Can't Follow The Speaker"),
    ]);
  });

  test("lists hook variants and length cuts together, for every kind of video", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    const variants = screen.getByRole("region", { name: /^Hooks, lengths and ad variants/ });
    for (const name of [
      "UGC Ad Variants",
      "UGC Ad Variants From Creator Folders",
      "Ad Length Cuts In Every Shape",
      "Teasers In Three Lengths",
      "Opening Line Tests",
      "Hook And Ending Variants",
      "Length Cuts",
      "Opening Lines To Test",
    ]) {
      expect(within(variants).getByText(name, { exact: true })).toBeTruthy();
    }
    const music = screen.getByRole("region", { name: /^Music/ });
    expect(within(music).getByText("Song Teasers For Reels And Shorts")).toBeTruthy();
    expect(within(music).getByText("Song Teasers", { exact: true })).toBeTruthy();
  });
});
