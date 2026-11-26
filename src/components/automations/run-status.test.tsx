import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { RunStatusBadge } from "./run-status";

describe("a run's status badge", () => {
  test("a failed run where another branch finished says partly done", () => {
    render(<RunStatusBadge status="failed" partly />);
    const badge = screen.getByText("Partly done");
    expect(badge).toHaveAttribute("data-status", "partly");
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  test("a failed run with nothing finished still says failed", () => {
    render(<RunStatusBadge status="failed" partly={false} />);
    expect(screen.getByText("Failed")).toHaveAttribute("data-status", "failed");
  });

  test("partly only changes a failed run", () => {
    render(<RunStatusBadge status="done" partly />);
    expect(screen.getByText("Done")).toHaveAttribute("data-status", "done");
  });
});
