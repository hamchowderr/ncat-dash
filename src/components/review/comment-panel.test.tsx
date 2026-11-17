import { threadComments } from "@ncat-dash/review-core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { CommentPanel, type RoomComment } from "./comment-panel";
import { AGENT_PERSON } from "./person";

const people = [
  { id: "u1", name: "Maya Ortiz", image: null },
  { id: "u2", name: "Dev Patel", image: null },
];

const comment = (over: Partial<RoomComment> & { id: string }): RoomComment => ({
  parentId: null,
  version: 1,
  time: 0,
  body: "",
  authorId: "u1",
  authorName: "Maya Ortiz",
  createdAt: 1_700_000_000_000,
  resolved: false,
  mine: false,
  agent: null,
  ...over,
});

const NOTES = [
  comment({ id: "late", time: 5, body: "Love this line", authorId: "u2", authorName: "Dev Patel" }),
  comment({ id: "early", time: 2.4, body: "Logo covers the patch, @Dev Patel", mine: true }),
  comment({
    id: "reply",
    parentId: "early",
    time: 2.4,
    body: "Agreed",
    authorId: "u2",
    authorName: "Dev Patel",
    createdAt: 1_700_000_001_000,
  }),
];

function setup(comments: RoomComment[] = NOTES, timed = true) {
  const handlers = {
    onSeek: vi.fn(),
    onActive: vi.fn(),
    onComposerFocus: vi.fn(),
    onSend: vi.fn(async () => true),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
    onAskAgain: vi.fn(),
  };
  render(
    <CommentPanel
      threads={threadComments(comments)}
      loading={false}
      people={[AGENT_PERSON, ...people]}
      timed={timed}
      moment={7}
      active={null}
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe("the conversation about a clip", () => {
  test("shows threads in the order of the clip, replies under their thread", () => {
    setup();
    const threads = screen.getAllByRole("listitem");
    expect(threads).toHaveLength(2);
    expect(within(threads[0]).getByText(/Logo covers the patch/)).toBeInTheDocument();
    expect(within(threads[0]).getByText("Agreed")).toBeInTheDocument();
    expect(within(threads[1]).getByText("Love this line")).toBeInTheDocument();
    expect(screen.getByText("2 to resolve")).toBeInTheDocument();
  });

  test("marks a tagged teammate inside the text", () => {
    setup();
    const tag = screen.getByText("@Dev Patel");
    expect(tag).toHaveClass("font-medium");
    expect(tag.parentElement).toHaveTextContent("Logo covers the patch, @Dev Patel");
  });

  test("pressing a comment's moment jumps the clip there", async () => {
    const { onSeek, user } = setup();
    await user.click(screen.getByRole("button", { name: "Jump to 0:05" }));
    expect(onSeek).toHaveBeenCalledWith(5);
    // A reply carries no moment of its own.
    expect(screen.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(2);
  });

  test("resolving and bringing back a thread", async () => {
    const { onResolve, user } = setup([
      ...NOTES,
      comment({ id: "done", time: 9, body: "Fixed", resolved: true }),
    ]);
    await user.click(screen.getAllByRole("button", { name: "Resolve" })[0]);
    expect(onResolve).toHaveBeenCalledWith("early", true);
    await user.click(screen.getByRole("button", { name: "Resolved" }));
    expect(onResolve).toHaveBeenCalledWith("done", false);
  });

  test("says so when every thread is resolved", () => {
    setup([comment({ id: "a", body: "Done", resolved: true })]);
    expect(screen.getByText("All resolved")).toBeInTheDocument();
  });

  test("only your own comments can be deleted", async () => {
    const { onDelete, user } = setup();
    const buttons = screen.getAllByRole("button", { name: "Delete your comment" });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(onDelete).toHaveBeenCalledWith("early");
  });

  test("a reply goes to its thread and the reply box closes once saved", async () => {
    const { onSend, user } = setup();
    await user.click(screen.getAllByRole("button", { name: "Reply" })[1]);
    await user.type(screen.getByRole("textbox", { name: "Reply" }), "On it{Enter}");
    expect(onSend).toHaveBeenCalledWith("On it", "late");
    expect(screen.queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument();
  });

  test("a new comment is sent without a thread, at the moment on screen", async () => {
    const { onSend, onComposerFocus, user } = setup();
    const box = screen.getByRole("textbox", { name: /^Comment at this moment/ });
    await user.click(box);
    expect(onComposerFocus).toHaveBeenCalled();
    expect(screen.getByText("0:07")).toBeInTheDocument();
    await user.type(box, "New note{Enter}");
    expect(onSend).toHaveBeenCalledWith("New note");
  });

  test("selecting a thread reports it", async () => {
    const { onActive, user } = setup();
    await user.click(screen.getByText("Love this line"));
    expect(onActive).toHaveBeenCalledWith("late");
  });

  test("an empty clip explains what to do, and a still picture has no moments", () => {
    setup([], false);
    expect(screen.getByText("None on this clip yet")).toBeInTheDocument();
    expect(screen.getByText(/Write a note below/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Comment\. Type @/ })).toBeInTheDocument();
    expect(screen.queryByText("0:07")).not.toBeInTheDocument();
  });
});

describe("the agent in a thread", () => {
  const asked = comment({
    id: "q",
    time: 2,
    body: "@Agent is the logo too small here?",
    mine: true,
  });
  const answer = (over: Partial<RoomComment>) =>
    comment({
      id: "a",
      parentId: "q",
      time: 2,
      authorId: "agent",
      authorName: "Agent",
      createdAt: 1_700_000_002_000,
      ...over,
    });

  test("shows that it is looking while the answer is on its way", () => {
    setup([asked, answer({ agent: { askedBy: "u1", state: "thinking" }, mine: true })]);
    const thread = screen.getAllByRole("listitem")[0];
    expect(within(thread).getByText("Agent")).toBeInTheDocument();
    expect(within(thread).getByText("for Maya")).toBeInTheDocument();
    expect(within(thread).getByRole("status")).toHaveTextContent("Looking at the clip");
  });

  test("shows its answer like a reply, and the tag in the question is marked", () => {
    setup([
      asked,
      answer({
        body: "At 0:02 the logo is hard to read.",
        agent: { askedBy: "u1", state: "answered" },
        mine: true,
      }),
    ]);
    const thread = screen.getAllByRole("listitem")[0];
    expect(within(thread).getByText("At 0:02 the logo is hard to read.")).toBeInTheDocument();
    expect(within(thread).getByText("@Agent")).toHaveClass("text-primary");
    expect(within(thread).queryByRole("status")).not.toBeInTheDocument();
    expect(within(thread).getByRole("button", { name: "Delete this answer" })).toBeInTheDocument();
  });

  test("lets the person who asked ask again when no answer came", async () => {
    const { user, onAskAgain } = setup([
      asked,
      answer({
        body: "The agent could not be reached. Ask again in a moment.",
        agent: { askedBy: "u1", state: "failed" },
        mine: true,
      }),
    ]);
    await user.click(screen.getByRole("button", { name: "Ask again" }));
    expect(onAskAgain).toHaveBeenCalledWith("a");
  });

  test("nobody else gets to ask again for them", () => {
    setup([
      { ...asked, mine: false },
      answer({
        body: "The agent could not be reached. Ask again in a moment.",
        agent: { askedBy: "u1", state: "failed" },
        mine: false,
      }),
    ]);
    expect(screen.getByText(/could not be reached/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask again" })).not.toBeInTheDocument();
  });

  test("is offered first when typing @ in the comment box", async () => {
    const { user } = setup([]);
    await user.type(screen.getByRole("textbox", { name: /Comment at this moment/ }), "@");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Agent");
    await user.type(screen.getByRole("textbox", { name: /Comment at this moment/ }), "ag");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Agent"]);
  });
});
