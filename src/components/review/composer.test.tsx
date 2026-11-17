import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { Composer } from "./composer";

const people = [
  { id: "u1", name: "Maya Ortiz", image: null },
  { id: "u2", name: "Dev Patel", image: null },
  { id: "u3", name: "Marta Diaz", image: null },
];

function setup(onSend = vi.fn(async () => true), moment?: number) {
  render(<Composer people={people} moment={moment} placeholder="Comment" onSend={onSend} />);
  return { onSend, box: screen.getByRole("textbox", { name: "Comment" }), user: userEvent.setup() };
}

describe("the comment box", () => {
  test("Enter sends the trimmed text and clears the box", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "  Too slow here  {Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Too slow here");
    expect(box).toHaveValue("");
  });

  test("Shift+Enter starts a new line instead of sending", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "One{Shift>}{Enter}{/Shift}Two");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("One\nTwo");
  });

  test("nothing is sent while the box is empty", async () => {
    const { onSend, box, user } = setup();
    expect(screen.getByRole("button", { name: "Send comment" })).toBeDisabled();
    await user.type(box, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  test("the text is kept when saving fails", async () => {
    const { box, user } = setup(vi.fn(async () => false));
    await user.type(box, "Keep me{Enter}");
    expect(box).toHaveValue("Keep me");
  });

  test("the send button sends too", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "By button");
    await user.click(screen.getByRole("button", { name: "Send comment" }));
    expect(onSend).toHaveBeenCalledWith("By button");
  });

  test("shows the moment the comment will be pinned to, when there is one", () => {
    setup(undefined, 65);
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });
});

describe("tagging a teammate", () => {
  test("typing @ offers the team, narrowed by what follows", async () => {
    const { box, user } = setup();
    await user.type(box, "Nice @");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "MOMaya Ortiz",
      "DPDev Patel",
      "MDMarta Diaz",
    ]);
    await user.type(box, "ma");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.type(box, "y");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  test("Enter picks the highlighted name and does not send", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "@ma{ArrowDown}{Enter}");
    expect(box).toHaveValue("@Marta Diaz ");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(box, "look{Enter}");
    expect(onSend).toHaveBeenCalledWith("@Marta Diaz look");
  });

  test("a name can be clicked", async () => {
    const { box, user } = setup();
    await user.type(box, "@");
    await user.click(screen.getByRole("option", { name: /Dev Patel/ }));
    expect(box).toHaveValue("@Dev Patel ");
  });

  test("Escape closes the list until more is typed", async () => {
    const { box, user } = setup();
    await user.type(box, "@d{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(box, "e");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  test("the @ button starts a tag", async () => {
    const { box, user } = setup();
    await user.type(box, "Hi");
    await user.click(screen.getByRole("button", { name: "Tag a teammate" }));
    expect(box).toHaveValue("Hi @");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  test("an email address is not a tag", async () => {
    const { box, user } = setup();
    await user.type(box, "write to maya@");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
