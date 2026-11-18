import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { answerQuery, mutationOf, present, pushed, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { ReviewRoom } from "./review-room";

const REVIEW = "rev_1" as Id<"reviews">;

const people = [
  { id: "u1", name: "Jordan Lee", image: null },
  { id: "u2", name: "Maya Ortiz", image: null },
  { id: "u3", name: "Dev Patel", image: null },
];

const room = (over: Record<string, unknown> = {}) => ({
  _id: REVIEW,
  organizationId: TEAM.id,
  title: "Weekly clips",
  status: "open",
  createdAt: 1_700_000_000_000,
  decidedBy: null,
  decidedAt: null,
  holdsRun: false,
  fromRun: false,
  clips: [
    {
      _id: "clip_a",
      title: "Opening hello",
      versions: [{ url: "https://files.example/a.mp4", addedAt: 1 }],
      comments: 0,
      open: 0,
    },
    {
      _id: "clip_b",
      title: "Why the station matters",
      versions: [
        { url: "https://files.example/b.mp4", addedAt: 1 },
        { url: "https://files.example/b-v2.mp4", addedAt: 2 },
      ],
      comments: 3,
      open: 2,
    },
  ],
  ...over,
});

const note = (over: Record<string, unknown>) => ({
  parentId: null,
  version: 1,
  time: 0,
  body: "",
  authorId: "u2",
  authorName: "Maya Ortiz",
  createdAt: 1_700_000_000_000,
  resolved: false,
  mine: false,
  agent: null,
  ...over,
});

const NOTES: Record<string, unknown[]> = {
  clip_a: [],
  clip_b: [
    note({ id: "n1", version: 1, time: 2, body: "On version one" }),
    note({ id: "n2", version: 2, time: 1, body: "On version two" }),
  ],
};

function open(review: unknown = room(), focus?: { clip?: string; comment?: string }) {
  answerQuery(api.reviews.get, review);
  answerQuery(api.reviews.people, { me: "u1", people });
  answerQuery(
    api.reviews.comments,
    (args: Record<string, unknown>) => NOTES[args.clipId as string] ?? [],
  );
  const view = renderInApp(<ReviewRoom reviewId={REVIEW} focus={focus} />);
  return { ...view, user: userEvent.setup() };
}

const video = (container: HTMLElement) =>
  container.querySelector<HTMLVideoElement>('section[aria-label="Clip"] video')!;

beforeEach(() => {
  present.push({ userId: "u1", online: true, lastDisconnected: 0 });
});

describe("the review room", () => {
  test("shows a way back when the review is gone", () => {
    open(null);
    expect(screen.getByText(/This review is gone/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Review" })).toHaveAttribute("href", "/review");
  });

  test("opens on the first clip, at its newest version", () => {
    const { container } = open();
    expect(screen.getByRole("heading", { name: "Weekly clips" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Clip 1 of 2.*Opening hello/ })).toBeInTheDocument();
    expect(video(container)).toHaveAttribute("src", "https://files.example/a.mp4");
    // One version: nothing to switch between.
    expect(screen.queryByRole("group", { name: "Version" })).not.toBeInTheDocument();
  });

  test("a link to a comment opens its clip, at its version and moment, with its thread marked", async () => {
    const reply = note({ id: "r1", parentId: "n1", version: 1, time: 2, body: "A reply" });
    NOTES.clip_b.push(reply);
    const { container } = open(room(), { clip: "clip_b", comment: "r1" });
    expect(screen.getByRole("heading", { name: /Clip 2 of 2/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(video(container)).toHaveAttribute("src", "https://files.example/b.mp4"),
    );
    expect(screen.getByRole("button", { name: "Version 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(video(container).currentTime).toBe(2));
    expect(container.querySelector("#thread-n1")).toHaveClass("bg-muted/60");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    NOTES.clip_b.pop();
  });

  test("shows what the client said, and marks a client's comment", () => {
    NOTES.clip_a = [note({ id: "c", body: "Bigger logo", authorId: "guest:x", client: true })];
    const { container } = open(room({ clientVerdict: { name: "Riley", approved: false, at: 1 } }));
    expect(container.querySelector("[data-client-verdict=changes]")).toHaveTextContent(
      "Riley wants changes",
    );
    expect(screen.getByText("Client")).toBeVisible();
    expect(screen.getByRole("button", { name: "Share" })).toBeVisible();
    NOTES.clip_a = [];
  });

  test("a link to a comment that is gone still opens the room", () => {
    const { container } = open(room(), { clip: "clip_b", comment: "gone" });
    expect(screen.getByRole("heading", { name: /Clip 2 of 2/ })).toBeInTheDocument();
    expect(video(container)).toHaveAttribute("src", "https://files.example/b-v2.mp4");
  });

  test("the clip list shows what is open on each and switches the clip", async () => {
    const { container, user } = open();
    const list = screen.getByRole("navigation", { name: "Clips in this review" });
    expect(within(list).getByText("No comments")).toBeInTheDocument();
    expect(within(list).getByText("2 to resolve")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /Why the station matters/ }));
    expect(screen.getByRole("heading", { name: /Clip 2 of 2/ })).toBeInTheDocument();
    expect(video(container)).toHaveAttribute("src", "https://files.example/b-v2.mp4");
    expect(screen.getByText("On version two")).toBeInTheDocument();
    expect(screen.queryByText("On version one")).not.toBeInTheDocument();
  });

  test("the clip list shows a numbered picture of each clip's newest version", () => {
    open();
    const list = screen.getByRole("navigation", { name: "Clips in this review" });
    const previews = list.querySelectorAll("[data-clip-preview]");
    expect(previews).toHaveLength(2);
    expect(previews[1].querySelector("video")).toHaveAttribute(
      "src",
      "https://files.example/b-v2.mp4#t=0.1",
    );
    expect(Array.from(previews).map((preview) => preview.textContent)).toEqual(["1", "2"]);
  });

  test("the clip and its comments share one row, which sizes the clip to its shape", () => {
    open();
    const stage = screen.getByRole("region", { name: "Clip" });
    const comments = screen.getByRole("region", { name: "Comments" });
    expect(stage.parentElement).toBe(comments.parentElement);
    expect(stage.parentElement).toHaveClass("stage-row");
    expect(stage).toHaveAttribute("data-stage");
  });

  test("switching version changes the file and shows that version's comments", async () => {
    const { container, user } = open();
    await user.click(screen.getByRole("button", { name: /Why the station matters/ }));
    const versions = screen.getByRole("group", { name: "Version" });
    expect(within(versions).getByRole("button", { name: "Version 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(versions).getByRole("button", { name: "Version 1" }));
    expect(video(container)).toHaveAttribute("src", "https://files.example/b.mp4");
    expect(screen.getByText("On version one")).toBeInTheDocument();
    expect(screen.queryByText("On version two")).not.toBeInTheDocument();
  });

  test("a new comment is saved on the clip and version on screen, at the clip's moment", async () => {
    const { container, user } = open();
    await user.click(screen.getByRole("button", { name: /Why the station matters/ }));
    await user.click(screen.getByRole("button", { name: "Version 1" }));
    Object.defineProperty(video(container), "currentTime", { value: 3.5, writable: true });
    await user.type(
      screen.getByRole("textbox", { name: /^Comment at this moment/ }),
      "Trim this{Enter}",
    );
    expect(mutationOf(api.reviews.comment)).toHaveBeenCalledWith({
      clipId: "clip_b",
      body: "Trim this",
      time: 3.5,
      version: 1,
      parentId: undefined,
    });
  });

  test("writing a comment pauses the clip", async () => {
    const { container, user } = open();
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(video(container).paused).toBe(false);
    await user.click(screen.getByRole("textbox", { name: /^Comment at this moment/ }));
    expect(video(container).paused).toBe(true);
  });

  test("a reply, a resolve and a delete reach the backend", async () => {
    NOTES.clip_a = [note({ id: "mine", time: 4, body: "My note", authorId: "u1", mine: true })];
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.type(screen.getByRole("textbox", { name: "Reply" }), "More{Enter}");
    expect(mutationOf(api.reviews.comment)).toHaveBeenCalledWith(
      expect.objectContaining({ clipId: "clip_a", body: "More", parentId: "mine" }),
    );
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(mutationOf(api.reviews.resolve)).toHaveBeenCalledWith({
      commentId: "mine",
      resolved: true,
    });
    await user.click(screen.getByRole("button", { name: "Delete your comment" }));
    expect(mutationOf(api.reviews.removeComment)).toHaveBeenCalledWith({ commentId: "mine" });
    NOTES.clip_a = [];
  });

  test("the agent can be tagged from the comment box, and asked again when no answer came", async () => {
    NOTES.clip_a = [
      note({ id: "q", time: 2, body: "@Agent is it sharp?", authorId: "u1", mine: true }),
      note({
        id: "a",
        parentId: "q",
        time: 2,
        authorId: "agent",
        authorName: "Agent",
        body: "The agent could not be reached. Ask again in a moment.",
        agent: { askedBy: "u1", state: "failed" },
        mine: true,
      }),
    ];
    const { user } = open();
    const box = screen.getByRole("textbox", { name: /^Comment at this moment/ });
    await user.type(box, "@ag");
    await user.click(screen.getByRole("option", { name: /Agent/ }));
    await user.type(box, "what do you think?{Enter}");
    expect(mutationOf(api.reviews.comment)).toHaveBeenCalledWith(
      expect.objectContaining({ clipId: "clip_a", body: "@Agent what do you think?" }),
    );
    await user.click(screen.getByRole("button", { name: "Ask again" }));
    expect(mutationOf(api.reviews.askAgentAgain)).toHaveBeenCalledWith({ commentId: "a" });
    NOTES.clip_a = [];
  });

  test("pressing a face on the timeline jumps to that comment", async () => {
    const { container, user } = open();
    await user.click(screen.getByRole("button", { name: /Why the station matters/ }));
    const player = video(container);
    Object.defineProperty(player, "duration", { value: 6, configurable: true });
    Object.defineProperty(player, "currentTime", { value: 0, writable: true });
    player.dispatchEvent(new Event("loadedmetadata"));
    await user.click(await screen.findByRole("button", { name: "Maya Ortiz's comment at 0:01" }));
    expect(player.currentTime).toBe(1);
    expect(screen.getByText("0:01 / 0:06")).toBeInTheDocument();
  });

  test("a failed save tells the person and keeps their text", async () => {
    mutationOf(api.reviews.comment).mockRejectedValueOnce({ data: { message: "Too many." } });
    const { user } = open();
    const box = screen.getByRole("textbox", { name: /^Comment at this moment/ });
    await user.type(box, "Keep{Enter}");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too many."));
    expect(box).toHaveValue("Keep");
  });
});

describe("deciding a review", () => {
  test("Approve and Ask for changes send the decision", async () => {
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(mutationOf(api.reviews.decide)).toHaveBeenLastCalledWith({
      reviewId: REVIEW,
      approved: true,
    });
    await user.click(screen.getByRole("button", { name: "Ask for changes" }));
    expect(mutationOf(api.reviews.decide)).toHaveBeenLastCalledWith({
      reviewId: REVIEW,
      approved: false,
    });
  });

  test("says when an automation is waiting on the decision", () => {
    open(room({ holdsRun: true, fromRun: true }));
    expect(screen.getByText(/An automation is paused on this review/)).toBeInTheDocument();
  });

  test("a decided review shows who decided, and can be put back", async () => {
    const { user } = open(room({ status: "approved", decidedBy: "u2" }));
    expect(screen.getByText("Approved by Maya Ortiz")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Put back in review" }));
    expect(mutationOf(api.reviews.reopen)).toHaveBeenCalledWith({ reviewId: REVIEW });
  });

  test("an open review has nothing to put back", async () => {
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Delete review" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Put back in review" })).not.toBeInTheDocument();
  });

  test("deleting goes back to the list, and a refusal is shown", async () => {
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete review" }));
    await waitFor(() =>
      expect(pushed).toHaveBeenCalledWith("/review", { transitionTypes: ["nav-back"] }),
    );
    expect(mutationOf(api.reviews.remove)).toHaveBeenCalledWith({ reviewId: REVIEW });

    pushed.mockClear();
    mutationOf(api.reviews.remove).mockRejectedValueOnce({
      data: { message: "An automation is waiting on this review." },
    });
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete review" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("An automation is waiting on this review."),
    );
    expect(pushed).not.toHaveBeenCalled();
  });
});

describe("who is here and new versions", () => {
  test("shows the teammates in the room right now", () => {
    present.push(
      { userId: "u2", online: true, lastDisconnected: 0 },
      { userId: "u3", online: false, lastDisconnected: 5 },
    );
    open();
    const here = screen.getByRole("list", { name: "Here now" });
    expect(within(here).getAllByRole("listitem")).toHaveLength(2);
    expect(within(here).getByText("Maya Ortiz")).toBeInTheDocument();
    expect(within(here).queryByText("Dev Patel")).not.toBeInTheDocument();
    expect(screen.getByText("2 here now")).toBeInTheDocument();
  });

  test("shows a client in the room, marked as one, and who is typing where", async () => {
    NOTES.clip_a = [note({ id: "t1", body: "Logo?", authorId: "guest:riley", client: true })];
    present.push(
      {
        userId: "guest:riley",
        online: true,
        lastDisconnected: 0,
        data: {
          name: "Riley Client",
          client: true,
          typing: { clipId: "clip_a", version: 1, threadId: "t1" },
        },
      },
      {
        userId: "u2",
        online: true,
        lastDisconnected: 0,
        data: { typing: { clipId: "clip_a", version: 1, threadId: null } },
      },
      {
        // Typing on another clip shows nowhere here.
        userId: "u3",
        online: true,
        lastDisconnected: 0,
        data: { typing: { clipId: "clip_b", version: 2, threadId: null } },
      },
    );
    const { user } = open();
    const here = screen.getByRole("list", { name: "Here now" });
    expect(within(here).getByText("Riley Client")).toBeInTheDocument();
    expect(screen.getByText("4 here now")).toBeInTheDocument();
    const comments = screen.getByRole("region", { name: "Comments" });
    const statuses = within(comments)
      .getAllByRole("status")
      .map((line) => line.textContent);
    expect(statuses).toEqual(["Riley is typing…", "Maya is typing…"]);
    await user.hover(within(here).getByText("Riley Client").closest("span")!);
    expect((await screen.findAllByText("Riley Client (client)")).length).toBeGreaterThan(0);
    NOTES.clip_a = [];
  });

  test("tells the room when you type, and when you stop", async () => {
    const { user } = open();
    const box = screen.getByRole("textbox", { name: /^Comment at this moment/ });
    await user.type(box, "Hi");
    const said = mutationOf(api.presence.typing);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith({
      roomId: REVIEW,
      typing: { clipId: "clip_a", version: 1, threadId: null },
    });
    await user.click(document.body);
    expect(said).toHaveBeenLastCalledWith({ roomId: REVIEW, typing: null });
  });

  test("says when you are alone", () => {
    open();
    expect(screen.getByText("Only you here")).toBeInTheDocument();
  });

  test("New version offers each recent file once, without the ones already used", async () => {
    answerQuery(api.jobs.outputs, [
      {
        jobId: "j2",
        stepId: "video-trim",
        finishedAt: 1_700_000_100_000,
        urls: ["https://files.example/a-tight.mp4", "https://files.example/a.mp4"],
      },
      {
        jobId: "j1",
        stepId: "video-trim",
        finishedAt: 1_700_000_000_000,
        urls: ["https://files.example/a-tight.mp4"],
      },
    ]);
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "New version" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a new version" });
    const files = within(dialog).getAllByRole("button", { name: /\.mp4/ });
    expect(files).toHaveLength(1);
    await user.click(files[0]);
    expect(mutationOf(api.reviews.addVersion)).toHaveBeenCalledWith({
      clipId: "clip_a",
      url: "https://files.example/a-tight.mp4",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("New version lists files by their readable names", async () => {
    const made = "https://files.example/ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10_output_0.mp4";
    answerQuery(api.jobs.outputs, [
      {
        jobId: "j3",
        stepId: "video-split",
        finishedAt: 1_700_000_100_000,
        urls: [made],
        names: { [made]: "Space interviews clip 1" },
      },
    ]);
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "New version" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a new version" });
    expect(within(dialog).getByRole("button", { name: /Space interviews clip 1/ })).toBeTruthy();
    expect(dialog.textContent).not.toContain("ca4934e3");
  });

  test("New version says so when there is nothing to pick", async () => {
    answerQuery(api.jobs.outputs, []);
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "New version" }));
    expect(await screen.findByText(/No other files yet/)).toBeInTheDocument();
  });
});
