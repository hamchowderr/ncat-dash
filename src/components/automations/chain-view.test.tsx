import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { STARTERS } from "@takewon/automation-core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed, toastInfo } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { ReactFlowProvider } from "@xyflow/react";

import { chainNodeTypes, ChainView, chainLayout } from "./chain-view";
import { FollowOnsPanel, useSetUp } from "./follow-ons";

const CLIPS = "auto_clips" as Id<"automations">;
const BRAND = "auto_brand" as Id<"automations">;
const BACKUP = "auto_backup" as Id<"automations">;

const starter = (id: string) => STARTERS.find((each) => each.id === id)!;

function member(
  automationId: Id<"automations">,
  starterId: string,
  extra: Partial<{ enabled: boolean; suggestions: string[]; lastRun: unknown }> = {},
) {
  const { name, trigger, nodes, edges } = starter(starterId);
  return {
    automationId,
    name,
    enabled: true,
    trigger: trigger.kind === "finished" ? { ...trigger, automationId: CLIPS } : trigger,
    nodes,
    edges,
    lastRun: null,
    suggestions: [],
    ...extra,
  };
}

const VIEW = {
  columns: [[CLIPS], [BRAND, BACKUP]],
  links: [
    { from: CLIPS, to: BRAND, how: "done" as const },
    { from: CLIPS, to: BACKUP, how: "failed" as const },
  ],
  automations: [
    member(CLIPS, "social-clips", {
      lastRun: { runId: "run_1", status: "done", at: Date.UTC(2026, 10, 20, 9) },
    }),
    member(BRAND, "brand-every-clip", { enabled: false, suggestions: ["ready-to-post"] }),
    member(BACKUP, "backup-clips-follow-speaker"),
  ],
};

type Member = (typeof VIEW)["automations"][number];

// The canvas shows its cards once it has measured them, which a test page never does, so
// the cards are drawn on their own here and the browser test walks the whole canvas.
function showAutomation(member: Member, current = false) {
  const Card = chainNodeTypes.automation;
  const props = {
    id: member.automationId,
    data: { member, current },
  } as unknown as Parameters<typeof Card>[0];
  renderInApp(
    <ReactFlowProvider>
      <Card {...props} />
    </ReactFlowProvider>,
  );
}

function Suggestion({ after, starterId }: { after: Member; starterId: string }) {
  const { pending, onSetUp } = useSetUp({ open: false });
  const Card = chainNodeTypes.suggestion;
  const data = {
    starter: starter(starterId),
    after,
    pending: pending !== null,
    disabled: pending !== null,
    onSetUp: () => void onSetUp(after.automationId, after.name, starter(starterId)),
  };
  const props = { id: "suggest", data } as unknown as Parameters<typeof Card>[0];
  return <Card {...props} />;
}

describe("the chain view", () => {
  test("shows each automation with how it starts, its last run and a way to open it", () => {
    showAutomation(VIEW.automations[0]);
    const clips = screen.getByRole("article", { name: "Clips for social" });
    expect(within(clips).getByRole("link", { name: "Clips for social" })).toHaveAttribute(
      "href",
      `/automations/${CLIPS}`,
    );
    expect(within(clips).getByRole("link", { name: /Last run/ })).toHaveAttribute(
      "href",
      `/automations/${CLIPS}/runs/run_1`,
    );
    expect(within(clips).getByText(/^On, starts when/)).toBeInTheDocument();
  });

  test("names the one being looked at instead of linking it", () => {
    showAutomation(VIEW.automations[1], true);
    const brand = screen.getByRole("article", { name: "Brand Every Clip" });
    expect(within(brand).getByText("This automation")).toBeInTheDocument();
    expect(within(brand).queryByRole("link", { name: "Brand Every Clip" })).toBeNull();
    // It follows another, so the line into it says when it starts.
    expect(within(brand).getByText("Off")).toBeInTheDocument();
    expect(within(brand).getByText("Has not run yet")).toBeInTheDocument();
  });

  test("builds a suggestion in one click and stays on the chain", async () => {
    mutationOf(api.automations.setUpFollowOn).mockResolvedValue({
      automationId: "auto_post",
      on: false,
      problem: "Connect your toolkit from Home first.",
    });
    renderInApp(
      <ReactFlowProvider>
        <Suggestion after={VIEW.automations[1]} starterId="ready-to-post" />
      </ReactFlowProvider>,
    );
    const card = screen.getByRole("article", { name: "Suggested: Ready To Post" });
    expect(within(card).getByText("Goes well after Brand Every Clip")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Build Ready To Post" }));
    expect(mutationOf(api.automations.setUpFollowOn)).toHaveBeenCalledWith({
      automationId: BRAND,
      starterId: "ready-to-post",
    });
    expect(toastInfo).toHaveBeenCalledWith(
      "Ready To Post is built but off for now. Connect your toolkit from Home first.",
    );
    expect(pushed).not.toHaveBeenCalled();
  });

  test("counts the linked automations above the canvas", () => {
    answerQuery(api.automations.chainView, VIEW);
    renderInApp(<ChainView automationId={BRAND} />);
    expect(
      screen.getByText(/^3 automations that start each other\. Each still runs on its own/),
    ).toBeInTheDocument();
  });

  test("says when nothing is linked yet", () => {
    answerQuery(api.automations.chainView, {
      columns: [[CLIPS]],
      links: [],
      automations: [member(CLIPS, "social-clips")],
    });
    renderInApp(<ChainView automationId={CLIPS} />);
    expect(
      screen.getByText("Nothing starts this automation and nothing starts after it yet."),
    ).toBeInTheDocument();
  });

  test("lays suggestions out in the column after their automation, below what is there", () => {
    const { automations, suggestions } = chainLayout(
      VIEW as unknown as Parameters<typeof chainLayout>[0],
    );
    expect(automations.get(CLIPS)).toEqual({ x: 0, y: 0 });
    expect(automations.get(BACKUP)!.x).toBe(automations.get(BRAND)!.x);
    expect(automations.get(BACKUP)!.y).toBeGreaterThan(automations.get(BRAND)!.y);
    expect(suggestions[2]).toEqual([[BRAND, "ready-to-post"]]);
  });

  test("is reached from the After this column when the automation is linked", async () => {
    let shown = false;
    renderInApp(
      <FollowOnsPanel
        automationId={CLIPS}
        automationName="Clips for social"
        followOns={{ following: [], suggestions: [] }}
        onShowChain={() => {
          shown = true;
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "See the whole chain" }));
    expect(shown).toBe(true);
  });
});
