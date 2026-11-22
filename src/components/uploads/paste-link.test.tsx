import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NodePanel } from "@/components/automations/node-panel";
import { VideoLinksCard } from "@/components/settings/video-links-card";
import { actionOf, answerQuery, mutationOf, resetConvex, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { UploadsView } from "./uploads-view";

/** Pasting a link to a video: on the Uploads page, in the look step, and its Settings page. */

const LINK = "https://www.tiktok.com/@salthouse/video/123";

const link = (overrides: Record<string, unknown> = {}) => ({
  _id: "link_1",
  url: LINK,
  site: "tiktok.com",
  status: "importing",
  error: null,
  forLook: null,
  uploadId: "up_9",
  at: 0,
  ...overrides,
});

function uploadsPage() {
  answerQuery(api.storage.get, { bucket: "ncat", publicUrl: null, baseUrl: "https://t.example" });
  answerQuery(api.storage.listUploads, []);
  actionOf(api.storage.previewLinks).mockResolvedValue([]);
  answerQuery(api.looks.list, { canEdit: true, looks: [], study: null });
  renderInApp(<UploadsView />);
}

function lookStep() {
  renderInApp(
    <NodePanel
      node={{ id: "step_1", kind: "step", stepId: "recipe-saved-look", input: {} }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe("a video from a link, on Uploads", () => {
  beforeEach(() => resetConvex());

  test("pasting a link brings the video in", async () => {
    answerQuery(api.links.recent, []);
    const bringIn = mutationOf(api.links.bringIn);
    const user = userEvent.setup();
    uploadsPage();
    const field = screen.getByLabelText("Paste a link to a video");
    expect(screen.getByRole("button", { name: "Bring in" })).toBeDisabled();
    await user.type(field, LINK);
    await user.click(screen.getByRole("button", { name: "Bring in" }));
    expect(bringIn).toHaveBeenCalledWith({ organizationId: TEAM.id, url: LINK, forLook: false });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("On its way. It shows in Uploads once it is in."),
    );
    expect(field).toHaveValue("");
    expect(screen.getByRole("link", { name: "Settings, Video Links" })).toHaveAttribute(
      "href",
      "/settings/integrations/video-links",
    );
  });

  test("a link on its way says so; one that failed says why and can be put away", async () => {
    answerQuery(api.links.recent, [
      link(),
      link({
        _id: "link_2",
        site: "youtube.com",
        status: "failed",
        error:
          "The site asks for a sign-in before it shares this video. Add your browser's cookies in Settings, Video Links, then try again.",
      }),
    ]);
    const dismiss = mutationOf(api.links.dismiss);
    const user = userEvent.setup();
    uploadsPage();
    expect(screen.getByText("Bringing in the video from tiktok.com.")).toBeInTheDocument();
    expect(screen.getByText(/asks for a sign-in before it shares this video/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Put away" }));
    expect(dismiss).toHaveBeenCalledWith({ organizationId: TEAM.id, importId: "link_2" });
  });
});

describe("a video from a link, to copy its look", () => {
  beforeEach(() => resetConvex());

  test("in the step, with no videos uploaded, a link is pasted to copy its look", async () => {
    answerQuery(api.looks.list, { canEdit: true, looks: [], study: null });
    answerQuery(api.storage.listUploads, []);
    answerQuery(api.links.recent, []);
    const bringIn = mutationOf(api.links.bringIn);
    const user = userEvent.setup();
    lookStep();
    expect(screen.queryByLabelText("Copy a look from a video")).toBeNull();
    await user.type(screen.getByLabelText("Or paste a link to a video"), LINK);
    await user.click(
      screen.getByRole("button", { name: "Copy the look of the video at this link" }),
    );
    expect(bringIn).toHaveBeenCalledWith({ organizationId: TEAM.id, url: LINK, forLook: true });
  });

  test("while it comes in the step says so, and a failure offers another link", async () => {
    answerQuery(api.looks.list, { canEdit: true, looks: [], study: null });
    answerQuery(api.storage.listUploads, []);
    answerQuery(api.links.recent, [link({ forLook: "waiting" })]);
    lookStep();
    expect(
      screen.getByText(
        "Bringing in the video from tiktok.com. Its look is studied as soon as it is in.",
      ),
    ).toBeInTheDocument();
  });

  test("a link that could not be brought in offers another", async () => {
    answerQuery(api.looks.list, { canEdit: true, looks: [], study: null });
    answerQuery(api.storage.listUploads, []);
    answerQuery(api.links.recent, [
      link({
        status: "failed",
        forLook: "failed",
        error: "There is no video or sound at this link. It may be a post of photos.",
      }),
    ]);
    const dismiss = mutationOf(api.links.dismiss);
    const user = userEvent.setup();
    lookStep();
    expect(screen.getByText(/It may be a post of photos/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try another link" }));
    expect(dismiss).toHaveBeenCalledWith({ organizationId: TEAM.id, importId: "link_1" });
  });
});

const COOKIES = ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc";

function settings(videoCookies: unknown, canEdit = true) {
  answerQuery(api.teamSettings.get, { videoCookies, canEdit });
  renderInApp(<VideoLinksCard />);
}

describe("Settings, Video Links", () => {
  beforeEach(() => resetConvex());

  test("an owner pastes their cookies.txt and it is saved", async () => {
    actionOf(api.videoCookies.set).mockResolvedValue({ sites: ["youtube.com"] });
    const user = userEvent.setup();
    settings(null);
    expect(screen.getByText(/YouTube, Vimeo, Reddit and private posts/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get cookies.txt LOCALLY" })).toBeInTheDocument();
    const field = screen.getByLabelText("cookies.txt");
    await user.click(field);
    await user.paste(COOKIES);
    await user.click(screen.getByRole("button", { name: "Save cookies" }));
    expect(actionOf(api.videoCookies.set)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      text: COOKIES,
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Saved. Links from youtube.com now go in signed in.",
      ),
    );
    expect(field).toHaveValue("");
  });

  test("saved cookies show only the sites they are for, and can be removed", async () => {
    const user = userEvent.setup();
    settings({ sites: ["vimeo.com", "youtube.com"], setAt: Date.UTC(2026, 10, 21) });
    expect(screen.getByText("For vimeo.com, youtube.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("cookies.txt")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(mutationOf(api.videoCookies.remove)).toHaveBeenCalledWith({ organizationId: TEAM.id });
  });

  test("a member is told who can add them", () => {
    settings(null, false);
    expect(
      screen.getByText("No cookies yet. Only a team owner or admin can add them."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("cookies.txt")).toBeNull();
  });
});
