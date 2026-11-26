import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StoredElsewhere } from "./stored-elsewhere";

test("a file left on Takewon's storage says so, and that it still works", () => {
  render(<StoredElsewhere where="hosted" />);
  const label = screen.getByText("On Takewon's storage");
  expect(label.getAttribute("title")).toMatch(/still plays and runs from there/);
});

test("a file on an earlier storage says it must be uploaded again", () => {
  render(<StoredElsewhere where="earlier" />);
  expect(screen.getByText("On earlier storage").getAttribute("title")).toMatch(/Upload it again/);
});

test("a file on the team's storage now shows nothing", () => {
  const { container } = render(<StoredElsewhere where={null} />);
  expect(container.textContent).toBe("");
});
