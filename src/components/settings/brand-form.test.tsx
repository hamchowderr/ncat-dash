import { api } from "@convex/_generated/api";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";
import { missingTourTargets } from "@/test/tours";

import { BrandForm } from "./brand-form";
import { BRAND_TOUR } from "./brand-tour";

const CARD = "https://files.example/brand/card.png";

function form(brand: Record<string, string> = {}) {
  answerQuery(api.storage.listUploads, []);
  renderInApp(<BrandForm brand={brand} music={[]} canEdit />);
  return userEvent.setup();
}

describe("the brand form", () => {
  test("asks once for the card template, intro and outro the editing steps use", () => {
    form();
    expect(screen.getByText("Card template")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Intro: address of the file" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Outro: address of the file" })).toBeTruthy();
    expect(screen.getByText(/quote cards and end cards are written on/)).toBeTruthy();
  });

  test("saves them with the rest of the brand", async () => {
    const user = form({ color: "#FFCC00" });
    fireEvent.change(screen.getByRole("textbox", { name: "Card template: address of the file" }), {
      target: { value: CARD },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Outro: address of the file" }), {
      target: { value: "https://files.example/brand/outro.mp4" },
    });
    await user.click(screen.getByRole("button", { name: "Save brand" }));
    expect(mutationOf(api.teamSettings.setBrand)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      brand: { color: "#FFCC00", card: CARD, outro: "https://files.example/brand/outro.mp4" },
      music: [],
    });
  });

  test("shows a saved card template as chosen", () => {
    form({ card: CARD });
    expect(screen.getByText(CARD)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear Card template" })).toBeTruthy();
  });

  test("while setting up asks only for the logo and colour, keeping the rest when saved", async () => {
    answerQuery(api.storage.listUploads, []);
    const music = [{ name: "Upbeat", file: "https://files.example/upbeat.mp3" }];
    renderInApp(
      <BrandForm
        brand={{ card: CARD, font: "Inter" }}
        music={music}
        canEdit
        essentials
        submitLabel="Save and continue"
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByText("Logo")).toBeTruthy();
    expect(screen.getByText("Brand colour")).toBeTruthy();
    for (const hidden of ["Font", "Card template", "Intro", "Outro", "Music library"]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Brand colour" }), {
      target: { value: "#FFCC00" },
    });
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(mutationOf(api.teamSettings.setBrand)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      brand: { color: "#FFCC00", font: "Inter", card: CARD },
      music,
    });
  });
});

describe("a brand file whose upload was removed", () => {
  const names = (gone: string[]) => (args: Record<string, unknown>) =>
    (args.ids as string[]).map((id) => ({
      id,
      fileName: gone.includes(id) ? null : `${id}.png`,
    }));

  test("is marked on its own row, and the rest still saves", async () => {
    answerQuery(api.storage.listUploads, []);
    answerQuery(api.storage.uploadNames, names(["song1"]));
    const music = [{ name: "Upbeat", file: "upload:song1" }];
    renderInApp(<BrandForm brand={{ logo: "upload:logo1" }} music={music} canEdit />);
    const user = userEvent.setup();
    expect(screen.getByText("logo1.png")).toBeTruthy();
    expect(screen.getByText(/Removed from your uploads/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Brand colour" }), {
      target: { value: "#FFCC00" },
    });
    await user.click(screen.getByRole("button", { name: "Save brand" }));
    expect(mutationOf(api.teamSettings.setBrand)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      brand: { logo: "upload:logo1", color: "#FFCC00" },
      music,
    });
  });

  test("a removed logo says so and can be cleared and replaced", async () => {
    answerQuery(api.storage.listUploads, []);
    answerQuery(api.storage.uploadNames, names(["logo1"]));
    renderInApp(<BrandForm brand={{ logo: "upload:logo1" }} music={[]} canEdit />);
    const user = userEvent.setup();
    expect(screen.getByText("An upload that was removed")).toBeTruthy();
    expect(screen.getByText(/This file was removed from your uploads. Pick another/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear Logo" }));
    expect(screen.getByRole("textbox", { name: "Logo: address of the file" })).toBeTruthy();
    expect(screen.queryByText("An upload that was removed")).toBeNull();
  });
});

describe("the tour of the brand settings", () => {
  test("has a place on the page for every part it points at, music too", () => {
    form();
    expect(missingTourTargets(BRAND_TOUR, { includeOptional: true })).toEqual([]);
  });
});
