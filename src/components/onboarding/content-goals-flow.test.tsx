import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, replaced, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { ContentGoalsFlow } from "./content-goals-flow";

vi.mock("@/lib/upload", () => ({
  putWithProgress: (_url: string, _file: File, onProgress: (percent: number) => void) => {
    onProgress(100);
    return Promise.resolve();
  },
}));

const UNANSWERED = { kinds: [], apps: [], answered: false, canEdit: true };

function pick(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  answerQuery(api.contentGoals.get, UNANSWERED);
  answerQuery(api.library.runsOnUpload, null);
});

describe("asking what the team makes", () => {
  test("waits for at least one answer, then asks where they post", () => {
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    expect(screen.getByRole("heading", { name: "What Do You Make?" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    const kinds = within(screen.getByRole("group", { name: "What you make" }));
    expect(kinds.getAllByRole("button")).toHaveLength(8);
    expect(kinds.getByRole("button", { name: /Entrepreneurs/ })).toBeTruthy();
    const next = screen.getByRole("button", { name: /Continue/ });
    expect(next).toHaveProperty("disabled", true);
    pick(/Coaching or Courses/);
    expect(
      screen.getByRole("button", { name: /Coaching or Courses/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "Where do you post?" })).toBeTruthy();
    const apps = within(screen.getByRole("group", { name: "Where you post" }));
    for (const name of ["Instagram", "TikTok", "YouTube", "LinkedIn", "X", "Snapchat"]) {
      expect(apps.getByRole("button", { name })).toBeTruthy();
    }
  });

  test("counts on from the setting-up steps before it", () => {
    renderInApp(
      <ContentGoalsFlow
        organizationId={TEAM.id}
        stepsBefore={3}
        stepsTotal={7}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("Step 4 of 7")).toBeTruthy();
  });

  test("saves the answers and offers one pack for coaching, unticked, saying where AI is used", async () => {
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    pick(/Coaching or Courses/);
    pick(/Continue/);
    pick(/^TikTok$/);
    pick(/^Instagram$/);
    pick(/^Continue$/);
    expect(
      await screen.findByRole("heading", { name: "Suggest these on your uploads" }),
    ).toBeTruthy();
    expect(mutationOf(api.contentGoals.save)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      kinds: ["coaching"],
      apps: ["tiktok", "instagram"],
    });
    const list = within(screen.getByRole("list", { name: "Ready-made automations for you" }));
    const boxes = list.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    const pack = list.getByRole("checkbox", { name: /Coaching session pack/ });
    expect(pack.getAttribute("aria-checked")).toBe("false");
    expect(list.getAllByText("AI picks the moments")).toHaveLength(1);
    // Nothing that runs after another is offered while setting up.
    expect(screen.queryByText(/Runs after/)).toBeNull();
    expect(
      screen.getByRole("link", { name: /See all 89 ready-made automations/ }).getAttribute("href"),
    ).toBe("/automations/new");
    expect(screen.getByRole("button", { name: "Continue without these" })).toBeTruthy();
    fireEvent.click(pack);
    expect(screen.getByRole("button", { name: "Add 1 automation" })).toBeTruthy();
  });

  test("never offers two that make clips from the same upload", async () => {
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    pick(/Coaching or Courses/);
    pick(/Entrepreneurs/);
    pick(/Continue/);
    pick(/Continue without one/);
    await screen.findByRole("heading", { name: "Suggest these on your uploads" });
    const list = within(screen.getByRole("list", { name: "Ready-made automations for you" }));
    expect(list.getAllByRole("checkbox")).toHaveLength(2);
    expect(list.getByRole("checkbox", { name: /Coaching session pack/ })).toBeTruthy();
    expect(list.getByRole("checkbox", { name: /Caption every new upload/ })).toBeTruthy();
    expect(list.queryByRole("checkbox", { name: /Clips that follow the speaker/ })).toBeNull();
  });

  test("switches on only the ticked ones and says why any were left off", async () => {
    mutationOf(api.contentGoals.turnOn).mockResolvedValue([
      {
        starterId: "branded-clip",
        name: "Captioned video with your logo",
        automationId: "a1",
        on: false,
        problem: "Add logo needs your team's logo. Add it in Settings, under Brand.",
      },
    ]);
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    pick(/Business Videos/);
    pick(/Continue/);
    pick(/Continue without one/);
    await screen.findByRole("heading", { name: "Suggest these on your uploads" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Captioned video with your logo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 automation" }));
    expect(
      await screen.findByRole("heading", { name: "Upload your first recording" }),
    ).toBeTruthy();
    expect(mutationOf(api.contentGoals.turnOn)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      starterIds: ["branded-clip"],
    });
    expect(screen.getByText(/is made but off/)).toBeTruthy();
    expect(screen.getByText(/Add it in Settings, under Brand/)).toBeTruthy();
  });

  test("keeps a member's answers to suggestions, since only owners and admins save them", async () => {
    answerQuery(api.contentGoals.get, { ...UNANSWERED, canEdit: false });
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    pick(/Podcast/);
    pick(/Continue/);
    pick(/Continue without one/);
    expect(
      await screen.findByRole("heading", { name: "Suggest these on your uploads" }),
    ).toBeTruthy();
    expect(mutationOf(api.contentGoals.save)).not.toHaveBeenCalled();
  });

  test("starts from what was answered before", async () => {
    answerQuery(api.contentGoals.get, {
      kinds: ["music"],
      apps: ["youtube"],
      answered: true,
      canEdit: true,
    });
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    expect(screen.getByRole("button", { name: /^Music/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    pick(/Continue/);
    expect(screen.getByRole("button", { name: "YouTube" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("tells the person when the answers could not be saved", async () => {
    mutationOf(api.contentGoals.save).mockRejectedValue(new Error("boom"));
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    pick(/Music/);
    pick(/Continue/);
    pick(/Continue without one/);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Where do you post?" })).toBeTruthy();
  });
});

describe("the first upload", () => {
  async function toUpload() {
    mutationOf(api.contentGoals.turnOn).mockResolvedValue([
      {
        starterId: "coaching-session-pack",
        name: "Coaching session pack",
        automationId: "auto1",
        on: true,
        problem: null,
      },
    ]);
    pick(/Coaching or Courses/);
    pick(/Continue/);
    pick(/Continue without one/);
    await screen.findByRole("heading", { name: "Suggest these on your uploads" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Coaching session pack/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 automation" }));
    await screen.findByRole("heading", { name: "Upload your first recording" });
  }

  test("sends the recording and shows what ran on it, and what is one press away", async () => {
    actionOf(api.storage.startUpload).mockResolvedValue({
      uploadId: "up1",
      uploadUrl: "https://bucket.example/put",
    });
    answerQuery(api.library.runsOnUpload, (args: Record<string, unknown>) =>
      args.uploadId === "up1"
        ? {
            itemId: "item1",
            runs: [
              {
                _id: "run1",
                automationId: "auto1",
                automationName: "Coaching session pack",
                status: "running",
                byHand: true,
                followed: false,
                startedAt: 1,
                finishedAt: null,
                made: 0,
              },
            ],
            suggested: [{ _id: "auto2", name: "Sermon pack" }],
          }
        : null,
    );
    const onFinish = vi.fn();
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={onFinish} />);
    await toUpload();
    expect(screen.getByText(/Coaching session pack/).closest("li")?.textContent).toContain(
      "is ready for your uploads",
    );
    expect(screen.getByText(/about 5 minutes long/)).toBeTruthy();
    expect(screen.getByText(/Longer recordings work too/)).toBeTruthy();
    const file = new File(["video"], "Session with Dana.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("Choose a recording to upload"), {
      target: { files: [file] },
    });
    const started = await screen.findByRole("region", { name: "What your upload started" });
    expect(mutationOf(api.storage.finishUpload)).toHaveBeenCalledWith({ uploadId: "up1" });
    expect(within(started).getByText("Session with Dana.mp4")).toBeTruthy();
    expect(
      within(started)
        .getByRole("link", { name: /Coaching session pack/ })
        .getAttribute("href"),
    ).toBe("/automations/auto1/runs/run1");
    fireEvent.click(within(started).getByRole("button", { name: "Run Sermon pack on this file" }));
    await waitFor(() =>
      expect(actionOf(api.library.runAutomation)).toHaveBeenCalledWith({
        itemId: "item1",
        automationId: "auto2",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Go to the dashboard/ }));
    expect(onFinish).toHaveBeenCalled();
  });

  test("offers a coach their meeting app, each opening in a new tab", async () => {
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    await toUpload();
    const apps = within(screen.getByRole("region", { name: "Record your sessions on a call?" }));
    const zoom = apps.getByRole("link", { name: /Connect Zoom/ });
    expect(zoom.getAttribute("href")).toBe("/settings/integrations/zoom");
    expect(zoom.getAttribute("target")).toBe("_blank");
    expect(apps.getByRole("link", { name: /Connect Google Meet/ }).getAttribute("href")).toBe(
      "/settings/integrations/google-meet",
    );
    expect(apps.getByRole("link", { name: /Connect Microsoft Teams/ }).getAttribute("href")).toBe(
      "/settings/integrations/microsoft",
    );
  });

  test("leaves meeting apps out for music", async () => {
    mutationOf(api.contentGoals.turnOn).mockResolvedValue([]);
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={() => {}} />);
    pick(/^Music/);
    pick(/Continue/);
    pick(/Continue without one/);
    await screen.findByRole("heading", { name: "Suggest these on your uploads" });
    fireEvent.click(screen.getByRole("button", { name: "Continue without these" }));
    await screen.findByRole("heading", { name: "Upload your first recording" });
    expect(screen.queryByRole("region", { name: "Record your sessions on a call?" })).toBeNull();
  });

  test("can be skipped", async () => {
    const onFinish = vi.fn();
    renderInApp(<ContentGoalsFlow organizationId={TEAM.id} onFinish={onFinish} />);
    await toUpload();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onFinish).toHaveBeenCalled();
  });
});

describe("setting up without a toolkit", () => {
  test("ends by saying what is on and that recordings go in once a toolkit is connected", async () => {
    mutationOf(api.contentGoals.turnOn).mockResolvedValue([
      {
        starterId: "coaching-session-pack",
        name: "Coaching session pack",
        automationId: "auto1",
        on: true,
        problem: null,
      },
    ]);
    const onFinish = vi.fn();
    renderInApp(
      <ContentGoalsFlow
        organizationId={TEAM.id}
        stepsBefore={3}
        stepsTotal={7}
        hasToolkit={false}
        onFinish={onFinish}
      />,
    );
    pick(/Coaching or Courses/);
    pick(/Continue/);
    pick(/Continue without one/);
    await screen.findByRole("heading", { name: "Suggest these on your uploads" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Coaching session pack/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 automation" }));
    expect(
      await screen.findByRole("heading", { name: "Connect A Toolkit When You're Ready" }),
    ).toBeTruthy();
    expect(screen.getByText("Step 7 of 7")).toBeTruthy();
    expect(screen.queryByLabelText("Choose a recording to upload")).toBeNull();
    expect(screen.getByText(/Coaching session pack/).closest("li")?.textContent).toContain(
      "is ready for your uploads",
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect A Toolkit" }));
    expect(replaced).toHaveBeenCalledWith("/settings/toolkit");
    fireEvent.click(screen.getByRole("button", { name: /Go to the dashboard/ }));
    expect(onFinish).toHaveBeenCalled();
  });
});
