import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed, toastInfo, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { FollowOnsAfterRun, FollowOnsPanel, TeamFollowOns } from "./follow-ons";
import { TemplateGallery } from "./template-gallery";

const CLIPS = "auto_clips" as Id<"automations">;

describe("what runs after an automation", () => {
  test("lists the ones already following it and suggests ready-made follow-ons", () => {
    renderInApp(
      <FollowOnsPanel
        automationId={CLIPS}
        automationName="Clips for social"
        followOns={{
          following: [
            {
              automationId: "auto_post" as Id<"automations">,
              name: "Ready To Post",
              enabled: false,
              when: "done",
            },
          ],
          suggestions: ["brand-every-clip"],
        }}
      />,
    );
    const running = screen.getByRole("region", { name: "Runs after this" });
    expect(within(running).getByRole("link", { name: /Ready To Post/ })).toHaveAttribute(
      "href",
      "/automations/auto_post",
    );
    expect(within(running).getByText("after it works, off")).toBeInTheDocument();
    const suggested = screen.getByRole("region", { name: "Goes well after this" });
    expect(within(suggested).getByText("Brand Every Clip")).toBeInTheDocument();
    expect(within(suggested).getByRole("button", { name: "Build Brand Every Clip" })).toBeEnabled();
  });

  test("builds one in one click, wired after this automation, and opens it", async () => {
    mutationOf(api.automations.setUpFollowOn).mockResolvedValue({
      automationId: "auto_brand",
      on: true,
      problem: null,
    });
    renderInApp(
      <FollowOnsPanel
        automationId={CLIPS}
        automationName="Clips for social"
        followOns={{ following: [], suggestions: ["brand-every-clip"] }}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Build Brand Every Clip" }));
    expect(mutationOf(api.automations.setUpFollowOn)).toHaveBeenCalledWith({
      automationId: CLIPS,
      starterId: "brand-every-clip",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Brand Every Clip is built and on. It starts by itself each time Clips for social finishes.",
    );
    expect(pushed).toHaveBeenCalledWith("/automations/auto_brand", expect.anything());
  });

  test("says what is missing when the one built has to stay off", async () => {
    mutationOf(api.automations.setUpFollowOn).mockResolvedValue({
      automationId: "auto_brand",
      on: false,
      problem: "Add a logo needs your team's logo. Add it in Settings, under Brand.",
    });
    renderInApp(
      <FollowOnsPanel
        automationId={CLIPS}
        automationName="Clips for social"
        followOns={{ following: [], suggestions: ["brand-every-clip"] }}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Build Brand Every Clip" }));
    expect(toastInfo).toHaveBeenCalledWith(
      "Brand Every Clip is built but off for now. Add a logo needs your team's logo. Add it in Settings, under Brand.",
    );
  });

  test("with nothing made to follow it, says how to link one by hand", () => {
    renderInApp(
      <FollowOnsPanel
        automationId={CLIPS}
        automationName="Trim"
        followOns={{ following: [], suggestions: [] }}
      />,
    );
    expect(screen.getByText(/Right after another automation runs/)).toBeInTheDocument();
  });

  test("under a finished run, shows suggestions, and nothing when there are none", () => {
    answerQuery(api.automations.followOns, { following: [], suggestions: ["ready-to-post"] });
    const { unmount } = renderInApp(
      <FollowOnsAfterRun automationId={CLIPS} automationName="Brand Every Clip" />,
    );
    expect(screen.getByRole("region", { name: "Goes well after this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build Ready To Post" })).toBeInTheDocument();
    unmount();
    answerQuery(api.automations.followOns, { following: [], suggestions: [] });
    renderInApp(<FollowOnsAfterRun automationId={CLIPS} automationName="Brand Every Clip" />);
    expect(screen.queryByRole("region", { name: "Goes well after this" })).toBeNull();
  });
});

describe("the ready-made list", () => {
  test("has follow-ons in their own category, each saying what it runs after", async () => {
    renderInApp(<TemplateGallery onPick={() => {}} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^After another automation 10$/ }));
    expect(screen.getByText("Backup When Following The Speaker Fails")).toBeInTheDocument();
    expect(screen.getByText("Caption The Cleaned-Up Recording")).toBeInTheDocument();
    expect(screen.getByText("Runs after Clean Up Pauses And Retakes")).toBeInTheDocument();
    expect(screen.getByText("Runs if Vertical that follows the speaker fails")).toBeInTheDocument();
    expect(screen.getByText("Runs after Lyric video with highlighted words")).toBeInTheDocument();
  });
});

describe("on the Automations page", () => {
  test("suggests follow-ons for the team's automations, saying which each goes after", async () => {
    answerQuery(api.automations.teamFollowOns, [
      { automationId: "auto_clips", automationName: "Shorts clips", starterId: "brand-every-clip" },
    ]);
    mutationOf(api.automations.setUpFollowOn).mockResolvedValue({
      automationId: "auto_brand",
      on: true,
      problem: null,
    });
    renderInApp(<TeamFollowOns organizationId="team_1" />);
    const section = screen.getByRole("region", { name: "Goes well with what you have" });
    expect(within(section).getByText("After Shorts clips")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Build Brand Every Clip" }));
    expect(mutationOf(api.automations.setUpFollowOn)).toHaveBeenCalledWith({
      automationId: "auto_clips",
      starterId: "brand-every-clip",
    });
  });

  test("shows nothing when there is nothing to suggest", () => {
    answerQuery(api.automations.teamFollowOns, []);
    renderInApp(<TeamFollowOns organizationId="team_1" />);
    expect(screen.queryByRole("region", { name: "Goes well with what you have" })).toBeNull();
  });
});
