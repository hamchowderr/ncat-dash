import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TranscriptWait } from "./transcript-wait";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe("TranscriptWait", () => {
  test("says how long it has been going", () => {
    render(<TranscriptWait since={NOW - 12 * MIN} duration={64 * 60} now={NOW} />);
    expect(screen.getByText(/Being transcribed, 12 min so far\./)).toBeTruthy();
    expect(screen.queryByText(/taking longer than the video/)).toBeNull();
  });

  test("past the video's own length, says it is slow and when it is stopped", () => {
    render(<TranscriptWait since={NOW - 72 * MIN} duration={64 * 60} now={NOW} />);
    expect(screen.getByText(/1 h 12 min so far/)).toBeTruthy();
    expect(
      screen.getByText(/taking longer than the video itself.*not done after 3 h 12 min/),
    ).toBeTruthy();
  });

  test("just started: no time yet", () => {
    render(<TranscriptWait since={NOW - 10_000} duration={60} now={NOW} />);
    expect(screen.getByText(/^Being transcribed\. The words/)).toBeTruthy();
  });
});
