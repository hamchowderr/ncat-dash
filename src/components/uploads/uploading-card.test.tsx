import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { UploadingCard } from "./upload-media";

/** A file on its way up is a card with a spinning circle and its percentage, not a bar. */
describe("a file being uploaded", () => {
  test("shows as a card: a spinning circle, the percentage, and the file's name", () => {
    const { container } = render(<UploadingCard name="Podcast 8.mp4" percent={42.4} />);
    const progress = screen.getByRole("progressbar", { name: "Uploading Podcast 8.mp4" });
    expect(progress).toHaveAttribute("aria-valuenow", "42");
    expect(progress).toHaveTextContent("42%");
    expect(progress.querySelector("svg")).toHaveClass("animate-spin");
    expect(screen.getByText("Podcast 8.mp4")).toBeInTheDocument();
    // No full-width bar.
    expect(container.querySelector('[data-slot="progress"]')).toBeNull();
  });

  test("keeps the percentage between 0 and 100", () => {
    render(<UploadingCard name="a.mp4" percent={130} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
