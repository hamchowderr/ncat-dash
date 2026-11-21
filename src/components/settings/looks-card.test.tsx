import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { answerQuery, mutationOf, resetConvex, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { LooksCard } from "./looks-card";
import { SETTINGS_PAGES } from "./settings-pages";

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

describe("Settings, Looks", () => {
  beforeEach(() => resetConvex());

  test("is a Team settings page with a Title Case name", () => {
    expect(SETTINGS_PAGES.find((page) => page.slug === "looks")?.title).toBe("Looks");
  });

  test("copies the look of a video picked from the uploads", async () => {
    answerQuery(api.looks.list, shown());
    answerQuery(api.storage.listUploads, UPLOADS);
    const study = mutationOf(api.looks.study);
    const user = userEvent.setup();
    renderInApp(<LooksCard />);
    expect(
      screen.getByText("No saved looks yet. Copy one above to use it in your automations."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy its look" })).toBeDisabled();
    await user.click(screen.getByLabelText("Video to copy"));
    expect(screen.queryByRole("option", { name: "logo.png" })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "Cafe sample.mp4" }));
    await user.click(screen.getByRole("button", { name: "Copy its look" }));
    expect(study).toHaveBeenCalledWith({ organizationId: TEAM.id, uploadId: "up_1" });
  });

  test("shows what was seen, and saves it under a name with its captions for the shape", async () => {
    answerQuery(
      api.looks.list,
      shown({
        study: {
          _id: "study_1",
          status: "ready",
          sourceName: "Cafe sample.mp4",
          sheetUrl: "https://files.example/out/sheet.png",
          error: null,
          proposal: PROPOSAL,
          summary: SAVED.summary,
        },
      }),
    );
    const save = mutationOf(api.looks.save);
    const user = userEvent.setup();
    renderInApp(<LooksCard />);
    expect(
      screen.getByRole("img", { name: "Six frames from Cafe sample.mp4" }),
    ).toBeInTheDocument();
    expect(screen.getByText(`${SAVED.summary}.`)).toBeInTheDocument();
    expect(screen.getByText(PROPOSAL.notes)).toBeInTheDocument();
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Cafe sample");
    await user.clear(name);
    await user.type(name, "Cafe Reels");
    await user.click(screen.getByLabelText("Use its captions for every vertical video"));
    await user.click(screen.getByRole("button", { name: "Save look" }));
    expect(save).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      studyId: "study_1",
      name: "Cafe Reels",
      captionsForShape: true,
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved "Cafe Reels"'));
  });

  test("while it is studied it says so, and a failure says why", () => {
    answerQuery(
      api.looks.list,
      shown({
        study: {
          _id: "s",
          status: "working",
          sourceName: "Cafe sample.mp4",
          sheetUrl: null,
          error: null,
          proposal: null,
          summary: null,
        },
      }),
    );
    const { unmount } = renderInApp(<LooksCard />);
    expect(screen.getByText(/Studying Cafe sample\.mp4\./)).toBeInTheDocument();
    unmount();
    answerQuery(
      api.looks.list,
      shown({
        study: {
          _id: "s",
          status: "failed",
          sourceName: "Cafe sample.mp4",
          sheetUrl: null,
          error: "The agent could not be reached. Study the video again in a moment.",
          proposal: null,
          summary: null,
        },
      }),
    );
    renderInApp(<LooksCard />);
    expect(
      screen.getByText("The agent could not be reached. Study the video again in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try another video" })).toBeInTheDocument();
  });

  test("lists saved looks and removes one", async () => {
    answerQuery(api.looks.list, shown({ looks: [SAVED] }));
    answerQuery(api.storage.listUploads, UPLOADS);
    const remove = mutationOf(api.looks.remove);
    renderInApp(<LooksCard />);
    expect(screen.getByText("Cafe Reels")).toBeInTheDocument();
    expect(
      screen.getByText(/Copied from Cafe sample\.mp4\. Captions: the "Cafe Reels" caption style\./),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, lookId: "look_1" });
  });

  test("someone who cannot change them sees them, with no buttons, and is told why", () => {
    answerQuery(api.looks.list, shown({ canEdit: false, looks: [SAVED] }));
    renderInApp(<LooksCard />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Only a team owner or admin can change these.")).toBeInTheDocument();
  });
});
