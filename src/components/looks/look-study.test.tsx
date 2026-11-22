import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, resetConvex, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { NodePanel } from "@/components/automations/node-panel";
import { UploadsView } from "@/components/uploads/uploads-view";

const FRAME = {
  shape: "vertical",
  fill: "blur",
  brightness: 0,
  contrast: 1.2,
  saturation: 1.3,
  warmth: 0.4,
} as const;

const PROPOSAL = {
  frame: FRAME,
  captions: {
    style: "highlight",
    font_size: 106,
    bold: true,
    all_caps: true,
    max_words_per_line: 3,
    position: "middle_center",
    line_color: "#FFFFFF",
    word_color: "#22DD88",
    outline_color: "#000000",
    outline_width: 3,
  },
  shotSeconds: 3,
  notes: "Warm and punchy, over a blurred copy of itself.",
};

const SAVED = {
  _id: "look_1",
  name: "Cafe Reels",
  frame: FRAME,
  captionStyle: "Cafe Reels",
  shotSeconds: 3,
  notes: "",
  sourceName: "Cafe sample.mp4",
  sheetUrl: "https://files.example/out/sheet.png",
  summary:
    "Vertical, a blurred copy behind, punchier, more vivid, warmer, a new shot every 3 seconds",
  at: 0,
};

const UPLOADS = [
  {
    _id: "up_1",
    fileName: "Cafe sample.mp4",
    contentType: "video/mp4",
    status: "ready",
    purpose: null,
    size: 1000,
    _creationTime: 0,
    details: { duration: 20, hasVideo: true, width: 1080, height: 1920 },
  },
  {
    _id: "up_2",
    fileName: "logo.png",
    contentType: "image/png",
    status: "ready",
    purpose: "brand",
  },
];

const shown = (overrides: Record<string, unknown> = {}) => ({
  canEdit: true,
  looks: [],
  study: null,
  ...overrides,
});

const STUDY = (overrides: Record<string, unknown> = {}) => ({
  _id: "study_1",
  uploadId: "up_1",
  status: "ready",
  sourceName: "Cafe sample.mp4",
  sheetUrl: "https://files.example/out/sheet.png",
  error: null,
  proposal: PROPOSAL,
  summary: SAVED.summary,
  ...overrides,
});

/** The Match A Saved Look step in the automation builder. */
function step(input: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  renderInApp(
    <NodePanel
      node={{ id: "step_1", kind: "step", stepId: "recipe-saved-look", input }}
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

describe("copying a look", () => {
  beforeEach(() => resetConvex());

  test("from a video on the Uploads page", async () => {
    answerQuery(api.storage.get, { bucket: "ncat", publicUrl: null, baseUrl: "https://t.example" });
    answerQuery(api.storage.listUploads, UPLOADS);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    answerQuery(api.looks.list, shown());
    const study = mutationOf(api.looks.study);
    const user = userEvent.setup();
    renderInApp(<UploadsView />);
    await user.click(screen.getByRole("button", { name: "Open Cafe sample.mp4" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Copy its look" }));
    expect(study).toHaveBeenCalledWith({ organizationId: TEAM.id, uploadId: "up_1" });
  });

  test("the video's study shows on it, and is saved there", async () => {
    answerQuery(api.storage.get, { bucket: "ncat", publicUrl: null, baseUrl: "https://t.example" });
    answerQuery(api.storage.listUploads, UPLOADS);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    answerQuery(api.looks.list, shown({ study: STUDY() }));
    const save = mutationOf(api.looks.save);
    const user = userEvent.setup();
    renderInApp(<UploadsView />);
    await user.click(screen.getByRole("button", { name: "Open Cafe sample.mp4" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "Six frames from Cafe sample.mp4" }),
    ).toBeTruthy();
    expect(within(dialog).getByText(PROPOSAL.notes)).toBeTruthy();
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Cafe sample");
    await user.clear(name);
    await user.type(name, "Cafe Reels");
    await user.click(within(dialog).getByLabelText("Use its captions for every vertical video"));
    await user.click(within(dialog).getByRole("button", { name: "Save look" }));
    expect(save).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      studyId: "study_1",
      name: "Cafe Reels",
      captionsForShape: true,
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved "Cafe Reels"'));
  });

  test("someone who cannot change looks sees no copy button on a video", async () => {
    answerQuery(api.storage.get, { bucket: "ncat", publicUrl: null, baseUrl: "https://t.example" });
    answerQuery(api.storage.listUploads, UPLOADS);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    answerQuery(api.looks.list, shown({ canEdit: false }));
    const user = userEvent.setup();
    renderInApp(<UploadsView />);
    await user.click(screen.getByRole("button", { name: "Open Cafe sample.mp4" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Copy its look" })).toBeNull();
  });

  test("inside the step, with no looks yet: pick a video and copy it there", async () => {
    answerQuery(api.looks.list, shown());
    answerQuery(api.storage.listUploads, UPLOADS);
    const study = mutationOf(api.looks.study);
    const user = userEvent.setup();
    step();
    expect(screen.getByText(/Your team has no saved looks yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy its look" })).toBeDisabled();
    await user.click(screen.getByLabelText("Copy a look from a video"));
    expect(screen.queryByRole("option", { name: "logo.png" })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "Cafe sample.mp4" }));
    await user.click(screen.getByRole("button", { name: "Copy its look" }));
    expect(study).toHaveBeenCalledWith({ organizationId: TEAM.id, uploadId: "up_1" });
  });

  test("saving the look inside the step makes the step use it", async () => {
    answerQuery(api.looks.list, shown({ study: STUDY() }));
    const save = mutationOf(api.looks.save);
    save.mockResolvedValue("look_1");
    const user = userEvent.setup();
    const onChange = step();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Cafe Reels");
    await user.click(screen.getByRole("button", { name: "Save look" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ input: { look: "Cafe Reels" } }));
  });

  test("with looks saved, a new one is copied from the step too, and one can be removed", async () => {
    answerQuery(api.looks.list, shown({ looks: [SAVED] }));
    answerQuery(api.storage.listUploads, UPLOADS);
    const remove = mutationOf(api.looks.remove);
    const user = userEvent.setup();
    step();
    expect(screen.getByText(/Copied from Cafe sample\.mp4\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy a new look from a video" }));
    expect(screen.getByLabelText("Copy a look from a video")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: 'Remove "Cafe Reels"' }));
    expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, lookId: "look_1" });
  });

  test("while it is studied the step says so, and a failure says why", () => {
    answerQuery(api.looks.list, shown({ study: STUDY({ status: "working", proposal: null }) }));
    step();
    expect(screen.getByText(/Studying Cafe sample\.mp4\./)).toBeInTheDocument();
  });

  test("a failed study says why and offers another try", () => {
    answerQuery(
      api.looks.list,
      shown({
        study: STUDY({
          status: "failed",
          proposal: null,
          error: "The agent could not be reached. Study the video again in a moment.",
        }),
      }),
    );
    step();
    expect(
      screen.getByText("The agent could not be reached. Study the video again in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try another video" })).toBeInTheDocument();
  });

  test("someone who cannot change looks is told who can", () => {
    answerQuery(api.looks.list, shown({ canEdit: false }));
    step();
    expect(
      screen.getByText("A team owner or admin can copy a look from a video."),
    ).toBeInTheDocument();
  });
});
