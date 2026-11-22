import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { LogicSettings } from "./logic-panel";

const IF = { id: "if", kind: "if" as const, input: { check: "length", is: "longer", value: 60 } };

describe("an If's settings", () => {
  test("can check what is said in each file, for words that are typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderInApp(<LogicSettings node={IF} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Check each file's" }));
    await user.click(screen.getByRole("option", { name: "What is said" }));
    expect(onChange).toHaveBeenLastCalledWith({
      input: { check: "words", is: "mentions", text: "" },
    });

    const words = { ...IF, input: { check: "words", is: "mentions", text: "" } };
    rerender(<LogicSettings node={words} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Words to look for" }), {
      target: { value: "new menu" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      input: { check: "words", is: "mentions", text: "new menu" },
    });
    expect(screen.getByText(/The words come from a Transcribe step before this one/)).toBeTruthy();
  });
});
