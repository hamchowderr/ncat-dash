import { api } from "@convex/_generated/api";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { answerQuery, mutationOf } from "@/test/convex";

import { SharedReview } from "./shared-review";

const TOKEN = "a".repeat(64);
const KEY = "ncat-dash:share-guest";

const room = (over: Record<string, unknown> = {}) => ({
  title: "Weekly clips",
  teamName: "Salt House",
  status: "open",
  allowVerdict: true,
  verdict: null,
  clips: [
    {
      _id: "clip_a",
      title: "Opening hello",
      versions: [{ url: "https://files.example/a.mp4", addedAt: 1 }],
    },
  ],
  ...over,
});

const note = (over: Record<string, unknown>) => ({
  parentId: null,
  version: 1,
  time: 2,
  body: "",
  authorId: "guest:riley-browser-0001",
  authorName: "Riley",
  createdAt: 1_700_000_000_000,
  resolved: false,
  client: true,
  mine: true,
  agent: null,
  ...over,
});

function open(value: unknown = room(), comments: unknown[] = []) {
  answerQuery(api.sharedReview.room, value);
  answerQuery(api.sharedReview.comments, comments);
  const view = render(
    <TooltipProvider>
      <SharedReview token={TOKEN} />
    </TooltipProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

function signedAs(name = "Riley") {
  window.localStorage.setItem(KEY, JSON.stringify({ id: "riley-browser-0001", name }));
}

beforeEach(() => window.localStorage.clear());

describe("a review shared with a client", () => {
  test("says plainly when the link no longer works", () => {
    open(null);
    expect(screen.getByRole("heading", { name: "This review is no longer shared" })).toBeVisible();
  });

  test("asks for a name first, and keeps it for next time", async () => {
    const { user } = open();
    expect(screen.getByText("Salt House will see this name beside your comments.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.type(screen.getByLabelText("Your name"), "  Riley   Client ");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Reviewing as Riley Client")).toBeVisible();
    const kept = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(kept.name).toBe("Riley Client");
    expect(kept.id).toMatch(/^[A-Za-z0-9-]{16,64}$/);
  });

  test("a comment is sent with the link, the client's name and the moment", async () => {
    signedAs();
    const { user, container } = open();
    expect(screen.getByRole("heading", { name: "Weekly clips" })).toBeVisible();
    expect(screen.getByText("From Salt House")).toBeVisible();
    const player = container.querySelector("video")!;
    Object.defineProperty(player, "currentTime", { value: 4.5, writable: true });
    const box = screen.getByRole("textbox", { name: "Comment at this moment" });
    await user.type(box, "Bigger logo please{Enter}");
    expect(mutationOf(api.sharedReview.comment)).toHaveBeenCalledWith({
      token: TOKEN,
      guestId: "riley-browser-0001",
      name: "Riley",
      clipId: "clip_a",
      body: "Bigger logo please",
      time: 4.5,
      version: 1,
      parentId: undefined,
    });
  });

  test("shows threads without resolving or tagging, marks the client's, and lets them delete their own", async () => {
    signedAs();
    const { user } = open(room(), [
      note({ id: "c1", body: "Bigger logo please" }),
      note({
        id: "r1",
        parentId: "c1",
        body: "On it",
        authorId: "u1",
        authorName: "Maya Ortiz",
        client: false,
        mine: false,
      }),
    ]);
    const comments = screen.getByRole("region", { name: "Comments" });
    expect(within(comments).getByText("Client")).toBeVisible();
    expect(within(comments).queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(within(comments).getAllByRole("button", { name: "Delete your comment" })).toHaveLength(
      1,
    );
    await user.click(within(comments).getByRole("button", { name: "Delete your comment" }));
    expect(mutationOf(api.sharedReview.removeComment)).toHaveBeenCalledWith({
      token: TOKEN,
      guestId: "riley-browser-0001",
      commentId: "c1",
    });
    await user.type(screen.getByRole("textbox", { name: "Comment at this moment" }), "@");
    expect(screen.queryByRole("option")).toBeNull();
  });

  test("lets the client approve or ask for changes when the team allows it", async () => {
    signedAs();
    const { user } = open();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(mutationOf(api.sharedReview.verdict)).toHaveBeenCalledWith({
      token: TOKEN,
      guestId: "riley-browser-0001",
      name: "Riley",
      approved: true,
    });
  });

  test("shows what they said, hides the buttons when not asked, and shows the team's decision", () => {
    signedAs();
    const first = open(room({ verdict: { name: "Riley", approved: false, at: 1 } }));
    expect(screen.getByRole("status")).toHaveTextContent("Riley asked for changes");
    first.unmount();

    const second = open(room({ allowVerdict: false }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    second.unmount();

    open(room({ status: "approved" }));
    expect(screen.getByText("Approved by the team")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
