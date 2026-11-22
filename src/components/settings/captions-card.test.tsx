import { api } from "@convex/_generated/api";
import {
  BUILT_IN_BY_SHAPE,
  BUILT_IN_STYLES,
  type CaptionSetup,
  NO_CAPTION_SETUP,
} from "@ncat-dash/automation-core";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NodePanel, type TeamCaptions } from "@/components/automations/node-panel";
import { mutationOf, resetConvex } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { CaptionPreview } from "./caption-preview";
import { CaptionsCard } from "./captions-card";

vi.mock("convex/react", async () => (await import("@/test/convex")).convexReact);
vi.mock("sonner", async () => (await import("@/test/convex")).sonner);

const OURS: CaptionSetup = {
  fixes: [{ find: "chowder", replace: "Chowderr" }],
  styles: [{ name: "Night Shift", look: { style: "karaoke", word_color: "#FF4FA3" } }],
  byShape: { vertical: "Night Shift" },
};

function card(captions: CaptionSetup = NO_CAPTION_SETUP, canEdit = true) {
  return renderInApp(
    <CaptionsCard
      captions={captions}
      builtIn={BUILT_IN_STYLES}
      builtInByShape={BUILT_IN_BY_SHAPE}
      font="Inter"
      canEdit={canEdit}
    />,
  );
}

describe("Captions in Settings", () => {
  beforeEach(() => resetConvex());

  test("starts with no word fixes, the built-in styles, and a style for each shape", () => {
    card();
    expect(screen.getByText("No word fixes yet.")).toBeInTheDocument();
    for (const style of BUILT_IN_STYLES) {
      expect(screen.getByRole("button", { name: `${style.name}, built in` })).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: "Vertical videos" })).toHaveTextContent(
      "Bold highlight",
    );
    expect(screen.getByRole("combobox", { name: "Wide videos" })).toHaveTextContent("Clean");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("adds word fixes and saves them", () => {
    const save = mutationOf(api.teamSettings.setCaptions);
    card();
    fireEvent.click(screen.getByRole("button", { name: "Add a word" }));
    fireEvent.change(screen.getByLabelText("Word 1 heard as"), { target: { value: "otaku" } });
    fireEvent.change(screen.getByLabelText("Word 1 written as"), {
      target: { value: "Otaku Solutions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      captions: { fixes: [{ find: "otaku", replace: "Otaku Solutions" }], styles: [], byShape: {} },
    });
  });

  test("a built-in style is copied to change it, and the copy can be renamed and changed", () => {
    const save = mutationOf(api.teamSettings.setCaptions);
    card();
    fireEvent.click(screen.getByRole("button", { name: "Karaoke, built in" }));
    expect(screen.getByText(/Built in, so it stays as it is/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make a copy to change" }));
    const editor = screen.getByRole("group", { name: "Change Karaoke copy" });
    const name = within(editor).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Night Shift" } });
    fireEvent.blur(name);
    const ours = screen.getByRole("group", { name: "Change Night Shift" });
    fireEvent.change(within(ours).getByRole("textbox", { name: "Highlight colour" }), {
      target: { value: "#ff4fa3" },
    });
    fireEvent.click(within(ours).getByRole("radio", { name: "Top" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const sent = save.mock.calls[0][0].captions as CaptionSetup;
    expect(sent.styles).toEqual([
      {
        name: "Night Shift",
        look: {
          ...BUILT_IN_STYLES.find((style) => style.name === "Karaoke")!.look,
          word_color: "#FF4FA3",
          position: "top_center",
        },
      },
    ]);
  });

  test("renaming a style keeps it on the shapes it was picked for; removing it lets go", () => {
    const save = mutationOf(api.teamSettings.setCaptions);
    card(OURS);
    const editor = screen.getByRole("group", { name: "Change Night Shift" });
    const name = within(editor).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Nights" } });
    fireEvent.blur(name);
    expect(screen.getByRole("combobox", { name: "Vertical videos" })).toHaveTextContent("Nights");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save.mock.calls[0][0].captions.byShape).toEqual({ vertical: "Nights" });

    fireEvent.click(screen.getByRole("button", { name: "Remove style" }));
    expect(screen.getByRole("combobox", { name: "Vertical videos" })).toHaveTextContent(
      "Bold highlight",
    );
  });

  test("a style shows the few things people change most, with the rest folded away", () => {
    card(OURS);
    const editor = screen.getByRole("group", { name: "Change Night Shift" });
    expect(within(editor).getByLabelText("Word effect")).toBeInTheDocument();
    expect(within(editor).queryByLabelText("Font")).toBeNull();
    expect(within(editor).queryByLabelText("Shadow")).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "More options" }));
    expect(within(editor).getByLabelText("Font")).toBeInTheDocument();
    expect(within(editor).getByLabelText("Shadow")).toBeInTheDocument();
  });

  test("a name another style has is refused", () => {
    card(OURS);
    const editor = screen.getByRole("group", { name: "Change Night Shift" });
    fireEvent.change(within(editor).getByLabelText("Name"), { target: { value: "clean" } });
    expect(screen.getByText("Another style has this name.")).toBeInTheDocument();
  });

  test("someone who cannot change them sees them and is told why", () => {
    card(OURS, false);
    expect(screen.getByLabelText("Word 1 heard as")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add a word" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Only a team owner or admin can change these.")).toBeInTheDocument();
  });
});

describe("a caption preview", () => {
  test("draws the word being said in the highlight colour, in capitals when asked", () => {
    const { container } = renderInApp(
      <CaptionPreview
        look={{ style: "highlight", all_caps: true, word_color: "#F2B33D", max_words_per_line: 3 }}
      />,
    );
    const words = container.querySelectorAll("p span");
    expect(words).toHaveLength(3);
    expect((words[1] as HTMLElement).style.color).toBe("rgb(242, 179, 61)");
    expect((words[0] as HTMLElement).style.color).toBe("");
    expect((container.querySelector("p") as HTMLElement).style.textTransform).toBe("uppercase");
  });

  test("shows one word at a time for that effect", () => {
    const { container } = renderInApp(<CaptionPreview look={{ style: "word_by_word" }} />);
    expect(container.querySelectorAll("p span")).toHaveLength(1);
  });
});

const CAPTIONS: TeamCaptions = {
  setup: { ...OURS, fixes: [...OURS.fixes, { find: "otaku", replace: "Otaku" }] },
  builtIn: BUILT_IN_STYLES,
  builtInByShape: BUILT_IN_BY_SHAPE,
};

function panel(input: Record<string, unknown>, onChange = vi.fn()) {
  renderInApp(
    <NodePanel
      node={{ id: "caption_1", kind: "step", stepId: "video-caption", input }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      captions={CAPTIONS}
      onChange={onChange}
      onRemove={vi.fn()}
    />,
  );
  return onChange;
}

describe("a caption step's panel", () => {
  test("says which style each shape gets and that the team's word fixes are used", () => {
    panel({});
    expect(screen.getByRole("combobox", { name: "Caption style" })).toHaveTextContent(
      "Match the video's shape",
    );
    expect(
      screen.getByText(/Vertical: Night Shift · Wide: Clean · Square: Bold highlight/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 words your team fixes in every caption/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Settings" })[0]).toHaveAttribute(
      "href",
      "/settings/captions",
    );
  });

  test("shows a picked style", () => {
    panel({ caption_style: "Karaoke" });
    expect(screen.getByRole("combobox", { name: "Caption style" })).toHaveTextContent("Karaoke");
    expect(screen.getByText(/Used on every video, whatever its shape/)).toBeInTheDocument();
  });

  test("a step with its own look says so, and can go back to the team's styles", () => {
    const onChange = panel({ settings: { style: "classic", font_size: 40 }, language: "en" });
    expect(screen.getByText(/has its own look under More options/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the team's styles" }));
    expect(onChange).toHaveBeenCalledWith({ input: { language: "en" } });
  });

  test("keeps the picked style when another setting changes", () => {
    const onChange = panel({ caption_style: "Night Shift" });
    fireEvent.click(screen.getByText("More options"));
    fireEvent.change(screen.getByLabelText(/Language/), { target: { value: "en" } });
    expect(onChange).toHaveBeenLastCalledWith({
      input: expect.objectContaining({ caption_style: "Night Shift", language: "en" }),
    });
  });

  test("captions in the language spoken until another is picked", async () => {
    const onChange = panel({ caption_style: "Karaoke" });
    const picker = screen.getByRole("combobox", { name: "Caption language" });
    expect(picker).toHaveTextContent("The language spoken");
    expect(
      screen.getByText("Captions are in the language spoken in the video."),
    ).toBeInTheDocument();
    fireEvent.click(picker);
    fireEvent.change(await screen.findByPlaceholderText("Find a language"), {
      target: { value: "Japan" },
    });
    fireEvent.click(await screen.findByRole("option", { name: "Japanese" }));
    expect(onChange).toHaveBeenLastCalledWith({
      input: { caption_style: "Karaoke", caption_language: "ja" },
    });
  });

  test("shows a picked caption language, keeps it when another setting changes, and can go back", async () => {
    const onChange = panel({ caption_language: "es" });
    const picker = screen.getByRole("combobox", { name: "Caption language" });
    expect(picker).toHaveTextContent("Spanish");
    expect(screen.getByText(/Translated into Spanish once per video/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("More options"));
    fireEvent.change(screen.getByLabelText(/Language/), { target: { value: "en" } });
    expect(onChange).toHaveBeenLastCalledWith({
      input: expect.objectContaining({ caption_language: "es", language: "en" }),
    });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "The language spoken" }));
    expect(onChange).toHaveBeenLastCalledWith({ input: {} });
  });

  test("Generate caption file has no caption language", () => {
    renderInApp(
      <NodePanel
        node={{ id: "ass_1", kind: "step", stepId: "media-generate-ass", input: {} }}
        before={[]}
        startGivesFile
        filled={{}}
        brand={{}}
        music={[]}
        captions={CAPTIONS}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: "Caption language" })).toBeNull();
  });
});
