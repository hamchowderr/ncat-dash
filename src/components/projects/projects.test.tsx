import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, replaced, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { NewProjectView } from "./new-project-view";
import { ProjectView } from "./project-view";
import { ProjectsView } from "./projects-view";
import { missingTourTargets } from "@/test/tours";
import { PROJECT_TOUR } from "./project-tour";

const counts = { todo: 0, in_progress: 0, review: 0, approved: 0, published: 0 };

const listed = (over: Record<string, unknown>) => ({
  _id: "p1",
  name: "Episode 42",
  package: "Video podcast",
  client: null,
  cover: null,
  updatedAt: 1_700_000_000_000,
  total: 13,
  filled: 0,
  counts: { ...counts, todo: 13 },
  ...over,
});

const slot = (over: Record<string, unknown>) => ({
  _id: "s1",
  kind: "video",
  label: "Full episode",
  status: "todo",
  url: null,
  versions: 0,
  clipId: null,
  updatedAt: 0,
  ...over,
});

const project = (over: Record<string, unknown> = {}) => ({
  _id: "p1",
  organizationId: TEAM.id,
  name: "Episode 42",
  package: "Video podcast",
  client: null,
  review: null,
  createdAt: 0,
  updatedAt: 0,
  canDelete: true,
  total: 3,
  filled: 1,
  counts: { ...counts, todo: 1, review: 1, in_progress: 1 },
  slots: [
    slot({ _id: "s1" }),
    slot({
      _id: "s2",
      kind: "thumbnail",
      label: "Episode thumbnail",
      status: "review",
      url: "https://files.example/thumb.png",
      versions: 1,
      clipId: "c2",
    }),
    slot({ _id: "s3", kind: "short", label: "Short 1", status: "in_progress" }),
  ],
  ...over,
});

describe("the Projects list", () => {
  test("asks for the team's projects and explains them when there are none", () => {
    let asked: unknown;
    answerQuery(api.projects.list, (args: Record<string, unknown>) => {
      asked = args;
      return [];
    });
    renderInApp(<ProjectsView />);
    expect(asked).toEqual({ organizationId: TEAM.id });
    expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New project" })[0]).toHaveAttribute(
      "href",
      "/projects/new",
    );
  });

  test("shows each project with its package, client and how many slots hold a file", () => {
    answerQuery(api.projects.list, [
      listed({
        client: { _id: "k1", name: "Acme" },
        filled: 4,
        counts: { ...counts, todo: 9, review: 3, approved: 1 },
      }),
      listed({ _id: "p2", name: "Promo", package: "Batch of shorts" }),
    ]);
    renderInApp(<ProjectsView />);
    const rows = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/projects/p"));
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/projects/p1", "/projects/p2"]);
    expect(within(rows[0]).getByText("Video podcast · Acme")).toBeInTheDocument();
    expect(within(rows[0]).getByText("4 of 13")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("meter", { name: "Slots with a file" })).toHaveAttribute(
      "aria-valuenow",
      "4",
    );
    expect(within(rows[0]).getByText("In review")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("Published")).not.toBeInTheDocument();
    expect(within(rows[1]).getByText("Batch of shorts")).toBeInTheDocument();
  });
});

describe("making a project", () => {
  test("lists the slots a package will have and makes it for a client", async () => {
    const user = userEvent.setup();
    answerQuery(api.clients.list, [{ _id: "k1", name: "Acme" }]);
    const create = mutationOf(api.projects.create).mockResolvedValue("p9");
    renderInApp(<NewProjectView clientId="k1" />);

    const slots = screen.getByRole("region", { name: "Slots it will have" });
    // A video podcast: episode, its thumbnail, an audio version, and five shorts with thumbnails.
    expect(within(slots).getAllByRole("listitem")).toHaveLength(13);
    expect(within(slots).getByText("Audio version")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Shorts"));
    await user.type(screen.getByLabelText("Shorts"), "2");
    expect(within(slots).getAllByRole("listitem")).toHaveLength(7);

    await user.click(screen.getByLabelText(/Start empty/));
    expect(screen.queryByLabelText("Shorts")).not.toBeInTheDocument();
    expect(within(slots).getByText(/None yet/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/YouTube video/));

    expect(screen.getByLabelText("For")).toHaveValue("k1");
    await user.type(screen.getByLabelText("Name"), "Launch video");
    await user.click(screen.getByRole("button", { name: "Make project" }));
    expect(create).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      name: "Launch video",
      package: "youtube_video",
      shorts: 3,
      clientId: "k1",
    });
    await waitFor(() =>
      expect(replaced).toHaveBeenCalledWith("/projects/p9", { transitionTypes: ["nav-forward"] }),
    );
  });

  test("cannot be made without a name", () => {
    answerQuery(api.clients.list, []);
    renderInApp(<NewProjectView />);
    expect(screen.getByRole("button", { name: "Make project" })).toBeDisabled();
  });
});

describe("a project's page", () => {
  test("groups the slots by status in the list", () => {
    answerQuery(api.projects.get, project());
    answerQuery(api.clients.list, []);
    renderInApp(<ProjectView projectId={"p1" as never} />);
    expect(screen.getByLabelText("Project name")).toHaveValue("Episode 42");
    const toDo = screen.getByRole("region", { name: "To do" });
    expect(within(toDo).getByText("Full episode")).toBeInTheDocument();
    expect(within(toDo).getByText("No file")).toBeInTheDocument();
    const inReview = screen.getByRole("region", { name: "In review" });
    expect(within(inReview).getByText("Episode thumbnail")).toBeInTheDocument();
    expect(within(inReview).getByText("1 version")).toBeInTheDocument();
    // Empty statuses get no group in the list.
    expect(screen.queryByRole("region", { name: "Published" })).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  test("shows every status as a board column, and dragging a card moves it", async () => {
    const user = userEvent.setup();
    answerQuery(api.projects.get, project());
    answerQuery(api.clients.list, []);
    const setStatus = mutationOf(api.projects.setStatus);
    renderInApp(<ProjectView projectId={"p1" as never} />);
    await user.click(screen.getByRole("button", { name: "Board" }));

    const columns = ["To do", "In progress", "In review", "Approved", "Published"].map((name) =>
      screen.getByRole("region", { name }),
    );
    expect(within(columns[4]).queryAllByRole("listitem")).toHaveLength(0);

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "",
    };
    const card = within(columns[2]).getByRole("button", { name: /Episode thumbnail/ });
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(columns[3], { dataTransfer });
    fireEvent.drop(columns[3], { dataTransfer });
    expect(setStatus).toHaveBeenCalledWith({ deliverableId: "s2", status: "approved" });

    // A slot with no file cannot go to review.
    const empty = within(columns[0]).getByRole("button", { name: /Full episode/ });
    fireEvent.dragStart(empty, { dataTransfer });
    fireEvent.drop(columns[2], { dataTransfer });
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Put a file in Full episode before moving it to In review.",
    );
  });

  test("opens a slot beside the list, with a file to put in and its status", async () => {
    const user = userEvent.setup();
    answerQuery(api.projects.get, project({ review: { _id: "r1", status: "open" } }));
    answerQuery(api.clients.list, []);
    answerQuery(api.jobs.outputs, [
      {
        jobId: "j1",
        stepId: "video-caption",
        finishedAt: 1_700_000_000_000,
        urls: ["https://files.example/ep42_captioned.mp4", "https://files.example/cover.png"],
        names: { "https://files.example/ep42_captioned.mp4": "Episode 42 captioned.mp4" },
      },
    ]);
    const addVersion = mutationOf(api.projects.addVersion);
    const setStatus = mutationOf(api.projects.setStatus);
    renderInApp(<ProjectView projectId={"p1" as never} />);

    await user.click(screen.getByRole("button", { name: /Full episode/ }));
    const panel = screen.getByRole("region", { name: "Slot Full episode" });
    expect(within(panel).getByText("No file yet")).toBeInTheDocument();
    // Only files that fit a video slot are offered.
    expect(within(panel).queryByText("cover.png")).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Episode 42 captioned\.mp4/ }));
    expect(addVersion).toHaveBeenCalledWith({
      deliverableId: "s1",
      url: "https://files.example/ep42_captioned.mp4",
    });

    // Without a file, it cannot be moved past In progress.
    const status = within(panel).getByLabelText("Status");
    expect(within(status).getByRole("option", { name: "In review" })).toBeDisabled();
    await user.selectOptions(status, "in_progress");
    expect(setStatus).toHaveBeenCalledWith({ deliverableId: "s1", status: "in_progress" });

    await user.click(within(panel).getByRole("button", { name: "Close slot" }));
    expect(screen.queryByRole("region", { name: "Slot Full episode" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Episode thumbnail/ }));
    const filled = screen.getByRole("region", { name: "Slot Episode thumbnail" });
    expect(within(filled).getByRole("link", { name: "Open in the review room" })).toHaveAttribute(
      "href",
      "/review/r1?clip=c2",
    );
    expect(within(filled).getByText("Add a new version")).toBeInTheDocument();
  });

  test("a pasted link goes in as a version; renaming and removing a slot", async () => {
    const user = userEvent.setup();
    answerQuery(api.projects.get, project());
    answerQuery(api.clients.list, []);
    answerQuery(api.jobs.outputs, []);
    const addVersion = mutationOf(api.projects.addVersion);
    const rename = mutationOf(api.projects.renameSlot);
    const remove = mutationOf(api.projects.removeSlot);
    renderInApp(<ProjectView projectId={"p1" as never} />);
    await user.click(screen.getByRole("button", { name: /Short 1/ }));
    const panel = screen.getByRole("region", { name: "Slot Short 1" });

    await user.type(within(panel).getByLabelText("File link"), "https://x.example/short.mp4");
    await user.click(within(panel).getByRole("button", { name: "Add" }));
    expect(addVersion).toHaveBeenCalledWith({
      deliverableId: "s3",
      url: "https://x.example/short.mp4",
    });

    const name = within(panel).getByLabelText("Slot name");
    await user.clear(name);
    await user.type(name, "Opening hook{Enter}");
    expect(rename).toHaveBeenCalledWith({ deliverableId: "s3", label: "Opening hook" });

    await user.click(within(panel).getByRole("button", { name: "Remove slot" }));
    await user.click(within(panel).getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith({ deliverableId: "s3" });
  });

  test("adds a slot, changes the client, and deletes the project", async () => {
    const user = userEvent.setup();
    answerQuery(api.projects.get, project());
    answerQuery(api.clients.list, [{ _id: "k1", name: "Acme" }]);
    const addSlot = mutationOf(api.projects.addSlot);
    const setClient = mutationOf(api.projects.setClient);
    const remove = mutationOf(api.projects.remove);
    renderInApp(<ProjectView projectId={"p1" as never} />);

    await user.selectOptions(screen.getByLabelText("Kind of slot to add"), "thumbnail");
    await user.click(screen.getByRole("button", { name: "Add slot" }));
    expect(addSlot).toHaveBeenCalledWith({ projectId: "p1", kind: "thumbnail" });

    await user.selectOptions(screen.getByLabelText("Client"), "k1");
    expect(setClient).toHaveBeenCalledWith({ projectId: "p1", clientId: "k1" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith({ projectId: "p1" });
    await waitFor(() => expect(replaced).toHaveBeenCalledWith("/projects", expect.anything()));
  });

  test("a member who cannot delete sees no Delete, and a gone project says so", () => {
    answerQuery(api.projects.get, project({ canDelete: false }));
    answerQuery(api.clients.list, []);
    const { unmount } = renderInApp(<ProjectView projectId={"p1" as never} />);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    unmount();
    answerQuery(api.projects.get, null);
    renderInApp(<ProjectView projectId={"p1" as never} />);
    expect(screen.getByText("This project no longer exists.")).toBeInTheDocument();
  });
});

describe("running an automation on a slot", () => {
  test("starts the picked automation on the slot's file, once it has one", async () => {
    const user = userEvent.setup();
    answerQuery(api.projects.get, project());
    answerQuery(api.clients.list, []);
    answerQuery(api.jobs.outputs, []);
    answerQuery(api.automations.list, [{ _id: "a1", name: "Make the shorts" }]);
    const runOnSlot = mutationOf(api.projects.runOnSlot);
    renderInApp(<ProjectView projectId={"p1" as never} />);

    // An empty slot has nothing to run on.
    await user.click(screen.getByRole("button", { name: /Full episode/ }));
    expect(screen.queryByRole("region", { name: "Run an automation" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Episode thumbnail/ }));
    const run = screen.getByRole("region", { name: "Run an automation" });
    expect(within(run).getByRole("button", { name: "Run" })).toBeDisabled();
    await user.selectOptions(within(run).getByLabelText("Automation"), "a1");
    await user.click(within(run).getByRole("button", { name: "Run" }));
    expect(runOnSlot).toHaveBeenCalledWith({ deliverableId: "s2", automationId: "a1" });
  });
});

describe("the tour of a project", () => {
  test("has a place on the page for every part it points at", () => {
    answerQuery(api.projects.get, project());
    answerQuery(api.clients.list, []);
    renderInApp(<ProjectView projectId={"p1" as never} />);
    expect(missingTourTargets(PROJECT_TOUR)).toEqual([]);
  });
});
