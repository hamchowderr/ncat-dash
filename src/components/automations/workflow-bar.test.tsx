import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { chainNodeTypes } from "./chain-view";
import { WorkflowBar, workflowMarks } from "./workflow-bar";

const CUT = "auto_cut" as Id<"automations">;
const CAPTIONS = "auto_captions" as Id<"automations">;
const WORKFLOW = "wf_1" as Id<"workflows">;

const automations = [
  { automationId: CUT, name: "Cut", enabled: true, end: false, ownApproval: true },
  { automationId: CAPTIONS, name: "Captions", enabled: false, end: true, ownApproval: false },
];
const proposal = {
  name: "Cut",
  kind: "ugc" as const,
  clientId: null,
  review: { on: true, reviewers: [] },
  automations,
};
const workflow = {
  workflowId: WORKFLOW,
  name: "Weekly UGC",
  kind: "ugc" as const,
  clientId: null,
  clientName: null,
  review: { on: true, reviewers: ["u_jon"], timeLimit: 2, timeLimitUnit: "days" as const, whenTimeUp: "approve" as const },
  reviewWords: "Jon Bell, approves after 2 days",
  on: "partly" as const,
  automations,
  joinedTo: null,
};
const team = [
  { userId: "u_maya", name: "Maya Ortiz", email: "maya@example.test", role: "owner" },
  { userId: "u_jon", name: "Jon Bell", email: "jon@example.test", role: "member" },
];

function show(seen: unknown, clients: unknown[] = []) {
  answerQuery(api.workflows.forAutomation, seen);
  answerQuery(api.teams.members, team);
  answerQuery(api.clients.list, clients);
  renderInApp(<WorkflowBar automationId={CAPTIONS} />);
}

describe("the workflow bar on the Chain tab", () => {
  test("offers to make the chain a workflow, starting from what it guessed", async () => {
    show({ workflow: null, proposal });
    expect(
      screen.getByText("Make these 2 automations one workflow, with one review before the files go out."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make it a workflow" }));
    const dialog = screen.getByRole("dialog", { name: "Make it a workflow" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Cut");
    expect(within(dialog).getByRole("radio", { name: /UGC and ads/ })).toBeChecked();
    expect(within(dialog).getByRole("switch", { name: "One review before the files go out" })).toBeChecked();
    expect(
      within(dialog).getByText(/at the end of Captions, before anything goes to Files.*The Approval steps in Cut are passed through/),
    ).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText("Name"));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Weekly UGC");
    await userEvent.click(within(dialog).getByLabelText("Jon Bell"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Make workflow" }));
    expect(mutationOf(api.workflows.create)).toHaveBeenCalledWith({
      automationId: CAPTIONS,
      name: "Weekly UGC",
      kind: "ugc",
      clientId: null,
      review: { on: true, reviewers: ["u_jon"], timeLimit: 0 },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Weekly UGC is now a workflow");
  });

  test("a quick personal job switches the review off, and the switch can bring it back", async () => {
    show({ workflow: null, proposal });
    await userEvent.click(screen.getByRole("button", { name: "Make it a workflow" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /Quick personal job/ }));
    const review = within(dialog).getByRole("switch", { name: "One review before the files go out" });
    expect(review).not.toBeChecked();
    expect(within(dialog).getByText(/^Nothing waits for a person/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Who reviews")).toBeNull();
    await userEvent.click(review);
    expect(within(dialog).getByText("Who reviews")).toBeInTheDocument();
  });

  test("shows the workflow with its review, and switches all of it on", async () => {
    show({ workflow, proposal });
    const bar = screen.getByRole("region", { name: "Workflow" });
    expect(within(bar).getByText("Weekly UGC")).toBeInTheDocument();
    expect(within(bar).getByText("UGC and ads")).toBeInTheDocument();
    expect(
      within(bar).getByText("One review before the files go out: Jon Bell, approves after 2 days"),
    ).toBeInTheDocument();
    expect(within(bar).getByText("Partly on")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("switch", { name: "Weekly UGC is partly on" }));
    expect(mutationOf(api.workflows.setOn)).toHaveBeenCalledWith({ workflowId: WORKFLOW, on: true });
  });

  test("says which automation stops it switching on", async () => {
    mutationOf(api.workflows.setOn).mockRejectedValue({
      data: { message: "Captions: Connect your toolkit from Home first." },
    });
    show({ workflow, proposal });
    await userEvent.click(screen.getByRole("switch"));
    expect(toastError).toHaveBeenCalledWith("Captions: Connect your toolkit from Home first.");
  });

  test("changes its settings and client, or takes it away", async () => {
    show({ workflow, proposal }, [{ _id: "client_1", name: "Brightside" }]);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    let dialog = screen.getByRole("dialog", { name: "Workflow settings" });
    expect(within(dialog).getByTestId("review-summary")).toHaveTextContent(
      "Jon Bell, approves after 2 days",
    );
    await userEvent.click(within(dialog).getByRole("radio", { name: /Client work/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mutationOf(api.workflows.update)).toHaveBeenCalledWith({
      workflowId: WORKFLOW,
      name: "Weekly UGC",
      kind: "client",
      clientId: null,
      review: { on: true, reviewers: ["u_jon"], timeLimit: 2, timeLimitUnit: "days", whenTimeUp: "approve" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    dialog = screen.getByRole("dialog", { name: "Workflow settings" });
    expect(within(dialog).getByRole("combobox", { name: "Client" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Take the workflow away" }));
    expect(mutationOf(api.workflows.remove)).toHaveBeenCalledWith({ workflowId: WORKFLOW });
  });

  test("a review off reads plainly", () => {
    show({ workflow: { ...workflow, review: { on: false, reviewers: [] }, on: "off" }, proposal });
    expect(screen.getByText("No review: the files go out as soon as they are made.")).toBeInTheDocument();
  });
});

describe("the chain cards of a workflow", () => {
  test("mark where the review happens and which Approval steps it covers", () => {
    const marks = workflowMarks(workflow);
    expect(marks.get(CAPTIONS)).toEqual({ reviewHere: true, covered: false });
    expect(marks.get(CUT)).toEqual({ reviewHere: false, covered: true });
    expect(workflowMarks({ ...workflow, review: { on: false, reviewers: [] } }).size).toBe(0);
    expect(workflowMarks(null).size).toBe(0);

    const Card = chainNodeTypes.automation;
    const member = {
      automationId: CAPTIONS,
      name: "Captions",
      enabled: true,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      lastRun: null,
      suggestions: [],
    };
    const props = { id: CAPTIONS, data: { member, current: false, reviewHere: true } } as unknown as Parameters<typeof Card>[0];
    renderInApp(
      <ReactFlowProvider>
        <Card {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("Reviewed here before the files go out")).toBeInTheDocument();
  });
});
