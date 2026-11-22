import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { VersionsPanel } from "./versions-panel";

const AT = 1_700_000_000_000;

const listed = (over: { hasDraft?: boolean } = {}) => ({
  hasDraft: over.hasDraft ?? false,
  versions: [
    {
      _id: "v3",
      number: 3,
      at: AT + 2,
      source: "published",
      restoredFrom: 1,
      byName: "Dev Patel",
      changes: ["Removed Approval"],
      live: true,
    },
    {
      _id: "v2",
      number: 2,
      at: AT + 1,
      source: "saved",
      restoredFrom: null,
      byName: "Maya Ortiz",
      changes: ["Added Approval", 'Renamed to "Weekly clips"'],
      live: false,
    },
    {
      _id: "v1",
      number: 1,
      at: AT,
      source: "created",
      restoredFrom: null,
      byName: "Maya Ortiz",
      changes: [],
      live: false,
    },
  ],
});

const content = (id: string, number: number) => ({
  _id: id,
  number,
  name: "Weekly clips",
  trigger: { kind: "manual" },
  nodes: [
    { id: "wait_1", kind: "wait", input: { amount: 5, unit: "minutes" }, position: { x: 0, y: 0 } },
  ],
  edges: [],
});

function answer(over: { hasDraft?: boolean } = {}) {
  answerQuery(api.versions.list, listed(over));
  answerQuery(api.versions.get, (args: Record<string, unknown>) =>
    content(args.versionId as string, Number(String(args.versionId).slice(1))),
  );
}

describe("the Versions tab", () => {
  test("says what it will keep when there is nothing yet", () => {
    answerQuery(api.versions.list, { hasDraft: false, versions: [] });
    renderInApp(<VersionsPanel automationId={"a1" as never} />);
    expect(screen.getByText(/No versions are kept yet/)).toBeInTheDocument();
  });

  test("lists every version newest first, with who, how and what changed", () => {
    answer();
    renderInApp(<VersionsPanel automationId={"a1" as never} />);
    const rows = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(
        /^Version 3Live.*Brought back from version 1 by Dev Patel.*Removed Approval\.$/,
      ),
      expect.stringMatching(
        /^Version 2Saved by Maya Ortiz.*Added Approval\. Renamed to "Weekly clips"\.$/,
      ),
      expect.stringMatching(/^Version 1Made by Maya Ortiz/),
    ]);
    // The live version is open first, and cannot be brought back over itself.
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("This is the version that runs.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bring back as draft" })).not.toBeInTheDocument();
  });

  test("brings an earlier version back as the draft, after setting aside unsaved work", async () => {
    answer();
    const restore = mutationOf(api.versions.restore);
    restore.mockResolvedValue({ draft: true });
    const beforeRestore = vi.fn();
    const onRestored = vi.fn();
    renderInApp(
      <VersionsPanel
        automationId={"a1" as never}
        beforeRestore={beforeRestore}
        onRestored={onRestored}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Version 2/ }));
    expect(screen.getByText(/What runs stays the same until you publish/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bring back as draft" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(true));
    expect(beforeRestore).toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith({ versionId: "v2" });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Version 2 is the draft now/));
  });

  test("on the live version, with a draft open, offers to throw the draft away", async () => {
    answer({ hasDraft: true });
    const restore = mutationOf(api.versions.restore);
    restore.mockResolvedValue({ draft: false });
    renderInApp(<VersionsPanel automationId={"a1" as never} />);
    expect(screen.getByText(/Your draft has changes it does not/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Draft discarded/)),
    );
    expect(restore).toHaveBeenCalledWith({ versionId: "v3" });
  });

  test("says so when a version cannot be brought back", async () => {
    answer();
    mutationOf(api.versions.restore).mockRejectedValue(new Error("boom"));
    renderInApp(<VersionsPanel automationId={"a1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Version 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bring back as draft" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

describe("the draft bar after bringing a version back", () => {
  test("says which version the draft came from", async () => {
    const { DraftBar } = await import("./draft-bar");
    const draft = {
      name: "Weekly clips",
      trigger: { kind: "manual" as const },
      nodes: [],
      edges: [],
    };
    renderInApp(
      <DraftBar
        enabled
        live={draft}
        draft={draft}
        busy={false}
        restoredFrom={2}
        onPublish={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByText("Draft from version 2.")).toBeInTheDocument();
  });

  test("a version's logo step reads the team's brand, as the editor does", async () => {
    answerQuery(api.versions.list, listed());
    answerQuery(api.versions.get, (args: Record<string, unknown>) => ({
      ...content(args.versionId as string, 3),
      nodes: [
        {
          id: "logo_1",
          kind: "step",
          stepId: "recipe-logo",
          input: {},
          position: { x: 0, y: 0 },
        },
      ],
    }));
    answerQuery(api.teamSettings.get, { brand: { logo: "upload:logo.png" } });
    renderInApp(<VersionsPanel automationId={"a1" as never} />);
    expect(await screen.findByText("Add a logo")).toBeInTheDocument();
    expect(screen.queryByText(/Needs your logo/)).toBeNull();
  });

  test("without a team logo the same step says it needs one", async () => {
    answerQuery(api.versions.list, listed());
    answerQuery(api.versions.get, (args: Record<string, unknown>) => ({
      ...content(args.versionId as string, 3),
      nodes: [
        {
          id: "logo_1",
          kind: "step",
          stepId: "recipe-logo",
          input: {},
          position: { x: 0, y: 0 },
        },
      ],
    }));
    answerQuery(api.teamSettings.get, { brand: {} });
    renderInApp(<VersionsPanel automationId={"a1" as never} />);
    expect(await screen.findByText("Needs your logo")).toBeInTheDocument();
  });
});
