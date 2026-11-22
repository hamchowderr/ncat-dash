import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";
import { PicksPanel } from "./picks-panel";
import type { RunDetails } from "./run-steps";

type PanelNode = Parameters<typeof NodePanel>[0]["node"];

function panel(input: Record<string, unknown>) {
  const onChange = vi.fn();
  const node: PanelNode = { id: "subtitles_1", kind: "subtitles", input };
  renderInApp(
    <NodePanel
      node={node}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={onChange}
      onRemove={vi.fn()}
    />,
  );
  return onChange;
}

describe("the Translate Subtitles step", () => {
  test("asks for a language, and adds one picked from the list by typing", async () => {
    const onChange = panel({ languages: [] });
    expect(screen.getByText("Pick each language to write subtitles in.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a language" }));
    fireEvent.change(await screen.findByPlaceholderText("Find a language"), {
      target: { value: "portug" },
    });
    fireEvent.click(await screen.findByRole("option", { name: "Portuguese (Brazil)" }));
    expect(onChange).toHaveBeenLastCalledWith({ input: { languages: ["pt-BR"] } });
  });

  test("lists the languages picked, and takes one off", () => {
    const onChange = panel({ languages: ["es", "ja"] });
    const picked = screen.getByRole("list", { name: "Languages picked" });
    expect(
      within(picked)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Spanish", "Japanese"]);
    expect(screen.getByText(/One SRT file per video in each language/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take off Spanish" }));
    expect(onChange).toHaveBeenLastCalledWith({ input: { languages: ["ja"] } });
  });

  test("stops taking languages at ten", () => {
    panel({ languages: ["es", "fr", "de", "it", "pt", "ja", "ko", "zh", "hi", "ar"] });
    expect(screen.getByRole("button", { name: "10 languages at most" })).toBeDisabled();
  });

  test("says on the canvas which languages it writes", () => {
    expect(nodeLook({ kind: "subtitles", input: { languages: [] } }).kind).toBe(
      "No language picked yet",
    );
    expect(nodeLook({ kind: "subtitles", input: { languages: ["es", "fr"] } }).kind).toBe(
      "Spanish and French",
    );
    expect(
      nodeLook({ kind: "subtitles", input: { languages: ["es", "fr", "de", "ja"] } }).kind,
    ).toBe("Spanish, French and 2 more");
  });
});

describe("subtitles on the run page", () => {
  test("links each video's file in each language, and says when no speech was heard", () => {
    const run = {
      _id: "run_1",
      status: "done",
      testOf: undefined,
      edges: [],
      nodes: [{ id: "subtitles_1", kind: "subtitles", input: {}, position: { x: 0, y: 0 } }],
      steps: [
        {
          _id: "s1",
          nodeId: "subtitles_1",
          status: "done",
          outputs: [],
          jobs: [],
          subtitles: [
            {
              source: "https://files.example/cave.mp4",
              language: "es",
              name: "Cave Episode.es.srt",
              key: "Subtitles/Pod/Cave Episode.es.srt",
              link: "https://files.example/teams/t/Subtitles/Pod/Cave%20Episode.es.srt",
            },
            {
              source: "https://files.example/cave.mp4",
              language: "ja",
              name: "Cave Episode.ja.srt",
              key: "Subtitles/Pod/Cave Episode.ja.srt",
              link: "https://files.example/teams/t/Subtitles/Pod/Cave%20Episode.ja.srt",
            },
            { source: "https://files.example/quiet.mp4", language: "es", name: "Quiet.es.srt" },
          ],
        },
      ],
    } as unknown as RunDetails;
    renderInApp(<PicksPanel run={run} busy={false} onFindMore={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Translate Subtitles" });
    expect(within(section).getByText("Cave Episode")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Spanish" })).toHaveAttribute(
      "href",
      "https://files.example/teams/t/Subtitles/Pod/Cave%20Episode.es.srt",
    );
    expect(within(section).getByRole("link", { name: "Japanese" })).toHaveAttribute(
      "download",
      "Cave Episode.ja.srt",
    );
    expect(within(section).getByText("Quiet")).toBeInTheDocument();
    expect(within(section).getByText("No speech was heard in this video.")).toBeInTheDocument();
  });
});
