import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PickList } from "./pick-list";
import { Segmented } from "./segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

describe("a segmented control", () => {
  const options = [
    { value: "a", label: "Apples" },
    { value: "b", label: "Pears" },
  ] as const;

  test("shows every choice at once, with the picked one checked", () => {
    render(<Segmented aria-label="Fruit" value="b" onValueChange={vi.fn()} options={options} />);
    const group = screen.getByRole("radiogroup", { name: "Fruit" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Pears" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("radio", { name: "Apples" }).getAttribute("data-state")).toBe(
      "unchecked",
    );
  });

  test("tells its owner which one was picked", () => {
    const picked = vi.fn();
    render(<Segmented aria-label="Fruit" value="b" onValueChange={picked} options={options} />);
    fireEvent.click(screen.getByRole("radio", { name: "Apples" }));
    expect(picked).toHaveBeenCalledWith("a");
  });
});

describe("a pick list", () => {
  function List() {
    return (
      <Select defaultValue="one">
        <SelectTrigger aria-label="Count">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one" description="Just the one">
            One
          </SelectItem>
          <SelectItem value="two">Two</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  test("opens below its field instead of over it", async () => {
    render(<List />);
    fireEvent.click(screen.getByRole("combobox", { name: "Count" }));
    const list = await screen.findByRole("listbox");
    // Radix's "item-aligned" way lays the list over the field and what is under it.
    expect(list.getAttribute("data-align-trigger")).toBe("false");
    expect(list.closest("[data-radix-popper-content-wrapper]")).toBeTruthy();
  });

  test("keeps a choice's extra line out of the closed field", async () => {
    render(<List />);
    expect(screen.getByRole("combobox", { name: "Count" }).textContent).toBe("One");
    fireEvent.click(screen.getByRole("combobox", { name: "Count" }));
    const one = await screen.findByRole("option", { name: /One/ });
    expect(one.textContent).toContain("Just the one");
    expect(one.getAttribute("data-state")).toBe("checked");
  });
});

describe("the app's own pick list", () => {
  const options = [
    { value: "", label: "Your team" },
    { value: "k1", label: "Acme" },
  ];

  test("shows the empty choice by name and hands back an empty value for it", async () => {
    const changed = vi.fn();
    render(<PickList aria-label="Client" value="" onChange={changed} options={options} />);
    const field = screen.getByRole("combobox", { name: "Client" });
    expect(field.textContent).toBe("Your team");
    fireEvent.click(field);
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));
    expect(changed).toHaveBeenCalledWith("k1");
  });

  test("opens as the app's list, not the browser's", async () => {
    const changed = vi.fn();
    render(<PickList aria-label="Client" value="k1" onChange={changed} options={options} />);
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Client" }));
    fireEvent.click(await screen.findByRole("option", { name: "Your team" }));
    expect(changed).toHaveBeenCalledWith("");
  });
});
