import { PLATFORMS } from "@takewon/automation-core";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { StepFields, type StepFieldList } from "@/components/steps/step-fields";
import { renderInApp } from "@/test/render";

import { PlatformPicker } from "./platform-picker";

const FIELDS: StepFieldList = [
  {
    name: "video_url",
    schema: { type: "string", format: "uri", description: "The video" },
    required: true,
  },
];
const SOURCES = [
  { value: "from-trigger", label: "The file that started the run" },
  { value: "from-caption", label: "The file from Caption video" },
];

function fields(value: string) {
  return renderInApp(
    <StepFields
      fields={FIELDS}
      values={{ video_url: value }}
      onChange={vi.fn()}
      automatic={{ field: "video_url", sources: SOURCES }}
    />,
  );
}

describe("a file setting in a step", () => {
  test("left automatic, it says where the file comes from", () => {
    fields("");
    expect(screen.getByText("Uses the nearest video before this step.")).toBeTruthy();
  });

  test("pointed at an earlier step, it names that step's file", () => {
    fields("from-caption");
    expect(screen.getByText("Takes the file from Caption video.")).toBeTruthy();
    expect(screen.queryByText("The video")).toBeNull();
  });

  test("pointed at the starting file, it says so", () => {
    fields("from-trigger");
    expect(screen.getByText("Takes the file that started the run.")).toBeTruthy();
  });
});

describe("the platform tiles", () => {
  test("show every platform's whole name, even in a narrow panel", () => {
    renderInApp(<PlatformPicker compact value={undefined} onChange={vi.fn()} />);
    const names = Array.from(document.querySelectorAll("[data-platform-name]"));
    expect(names.map((name) => name.textContent?.trim())).toEqual(
      PLATFORMS.map((platform) => platform.name),
    );
    for (const name of names) expect(name.className).not.toContain("truncate");
    expect(screen.getByRole("radio", { name: /Instagram Stories/ })).toBeTruthy();
  });

  test("says what shape the chosen platform's clips are made in", () => {
    const { rerender } = renderInApp(
      <PlatformPicker compact value="Instagram feed" onChange={vi.fn()} />,
    );
    expect(
      screen.getByText("Portrait 4:5. The whole picture is kept, on a blurred background."),
    ).toBeTruthy();
    rerender(<PlatformPicker compact value="YouTube" onChange={vi.fn()} />);
    expect(
      screen.getByText("Wide 16:9. The whole picture is kept, on a blurred background."),
    ).toBeTruthy();
    rerender(<PlatformPicker compact value="X" onChange={vi.fn()} />);
    expect(screen.getByText("Keeps the video's own shape.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "YouTube, wide 16:9, up to 15 min" })).toBeTruthy();
  });

  test("choosing one hands it back", () => {
    const onChange = vi.fn();
    renderInApp(<PlatformPicker compact value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /YouTube Shorts/ }));
    expect(onChange).toHaveBeenCalledWith("YouTube Shorts");
  });
});

describe("a share link pasted as a file", () => {
  test("a Drive file link is taken as it is and said to work", () => {
    fields("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view");
    expect(screen.getByText(/Google Drive share link\. The file is downloaded/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a Dropbox folder link says to share one file instead", () => {
    fields("https://www.dropbox.com/scl/fo/abc/xyz?rlkey=k&dl=0");
    expect(screen.getByRole("alert").textContent).toBe(
      "This is a link to a Dropbox folder. Share one file from it instead.",
    );
  });

  test("an ordinary address gets no note", () => {
    fields("https://files.example/talk.mp4");
    expect(screen.queryByText(/share link/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a step run by hand says the same under its address box", () => {
    renderInApp(
      <StepFields
        fields={FIELDS}
        values={{ video_url: "https://www.dropbox.com/s/abc/talk.mp4?dl=0" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Dropbox share link\. The file is downloaded/)).toBeTruthy();
  });
});
