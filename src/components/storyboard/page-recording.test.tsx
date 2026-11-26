import { api } from "@convex/_generated/api";
import { statusOf } from "@convex/lib/storyboard";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf } from "@/test/convex";
import { pick, renderInApp, TEAM } from "@/test/render";

import { PageRecording } from "./page-recording";

/**
 * A take's page recording: record a web page with the agent, see it wait its turn and be
 * made, record it again with the same clicks, read the clicks, and sign in to a site once
 * for recordings of pages behind a sign-in.
 */

const TAKE = {
  _id: "t2",
  number: 2,
  line: "Here are the plans.",
  scene: "full",
  parts: ["recording"],
  files: {},
  status: statusOf(["recording"], {}),
} as never;
const BOARD = "sb1" as never;

const STEPS = [
  { do: "goto", url: "https://example.com/" },
  { do: "click", target: { role: "link", name: "Pricing", nth: 0 } },
];

function row(over: Record<string, unknown> = {}) {
  return {
    _id: "r1",
    takeId: "t2",
    url: "https://example.com/",
    notes: "",
    signInId: null,
    steps: [],
    status: "queued",
    problem: null,
    uploadId: null,
    durationMs: null,
    place: null,
    updatedAt: 0,
    ...over,
  };
}

function show(rows: unknown[], signIns: unknown[] = []) {
  answerQuery(api.pageRecordings.forStoryboard, rows);
  answerQuery(api.pageRecordings.signIns, signIns);
  renderInApp(<PageRecording take={TAKE} boardId={BOARD} organizationId={TEAM.id} />);
}

describe("a take's page recording", () => {
  test("is recorded from the page given, with what to show", async () => {
    show([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Record the page" }));
    const form = screen.getByRole("form", { name: "Record the page" });
    const record = within(form).getByRole("button", { name: "Record" });
    expect(record).toHaveProperty("disabled", true);
    await user.type(within(form).getByRole("textbox", { name: "Page address" }), "example.com");
    await user.type(
      within(form).getByRole("textbox", { name: /What to show/ }),
      "The yearly plans",
    );
    await user.click(record);
    expect(mutationOf(api.pageRecordings.record)).toHaveBeenCalledWith({
      takeId: "t2",
      url: "example.com",
      notes: "The yearly plans",
      signInId: null,
    });
    expect(screen.queryByRole("form", { name: "Record the page" })).toBeNull();
  });

  test("says where it is in line while it waits, and while it is made", () => {
    show([row({ place: 2 })]);
    expect(screen.getByRole("status").textContent).toBe("Waiting its turn, 2 in line");
    expect(screen.queryByRole("button", { name: /Record again/ })).toBeNull();
  });

  test("when recorded, can be recorded again the same way, and shows its clicks", async () => {
    show([row({ status: "done", steps: STEPS, durationMs: 8200 })]);
    const user = userEvent.setup();
    expect(screen.getByRole("status").textContent).toBe("Recorded, 8 seconds");
    await user.click(screen.getByRole("button", { name: "Show the clicks (2)" }));
    const clicks = within(screen.getByRole("list", { name: "The clicks" })).getAllByRole(
      "listitem",
    );
    expect(clicks.map((item) => item.textContent)).toEqual([
      "Open https://example.com/",
      'Click "Pricing"',
    ]);
    await user.click(screen.getByRole("button", { name: "Record again the same way" }));
    expect(mutationOf(api.pageRecordings.record)).toHaveBeenCalledWith({
      takeId: "t2",
      url: "https://example.com/",
      notes: "",
      signInId: null,
      again: true,
    });
  });

  test("says why it was not recorded, and can be tried again", async () => {
    show([row({ status: "failed", problem: "The agent could not find anything to click." })]);
    const user = userEvent.setup();
    expect(screen.getByRole("status").textContent).toBe("Not recorded");
    expect(screen.getByText("The agent could not find anything to click.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect((screen.getByRole("textbox", { name: "Page address" }) as HTMLInputElement).value).toBe(
      "https://example.com/",
    );
  });
});

describe("signing in for a recording", () => {
  test("a new sign-in opens the site to sign in, and is kept and picked once signed in", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    actionOf(api.pageRecordings.startSignIn).mockResolvedValueOnce({
      signInId: "s1",
      liveViewUrl: "https://live.example/s1",
    });
    show([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Record the page" }));
    await pick(user, screen.getByRole("combobox", { name: "Sign in as" }), "Add a sign-in");
    const setUp = screen.getByRole("form", { name: "New sign-in" });
    await user.type(
      within(setUp).getByRole("textbox", { name: "Name it" }),
      "Example Studio admin",
    );
    await user.type(
      within(setUp).getByRole("textbox", { name: "The site's sign-in page" }),
      "https://app.example.com/login",
    );
    await user.click(within(setUp).getByRole("button", { name: "Open the sign-in page" }));
    expect(actionOf(api.pageRecordings.startSignIn)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      name: "Example Studio admin",
      url: "https://app.example.com/login",
      shared: false,
    });
    expect(opened).toHaveBeenCalledWith("https://live.example/s1", "_blank", "noopener,noreferrer");
    expect(screen.getByRole("link", { name: "Open the sign-in page again" })).toHaveProperty(
      "href",
      "https://live.example/s1",
    );
    await user.click(screen.getByRole("button", { name: "I'm signed in" }));
    expect(actionOf(api.pageRecordings.finishSignIn)).toHaveBeenCalledWith({ signInId: "s1" });
    opened.mockRestore();
  });

  test("a saved sign-in is used for the recording", async () => {
    show(
      [],
      [
        {
          _id: "s1",
          name: "Example Studio admin",
          url: "https://app.example.com",
          status: "saved",
          savedAt: 1,
          mine: true,
          shared: false,
        },
      ],
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Record the page" }));
    await pick(
      user,
      screen.getByRole("combobox", { name: "Sign in as" }),
      "Example Studio admin (yours)",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Page address" }),
      "https://app.example.com",
    );
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(mutationOf(api.pageRecordings.record)).toHaveBeenCalledWith(
      expect.objectContaining({ signInId: "s1" }),
    );
  });

  test("a new sign-in is the person's own unless shared with the team", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    actionOf(api.pageRecordings.startSignIn).mockResolvedValueOnce({
      signInId: "s2",
      liveViewUrl: "https://live.example/s2",
    });
    show([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Record the page" }));
    await pick(user, screen.getByRole("combobox", { name: "Sign in as" }), "Add a sign-in");
    const setUp = screen.getByRole("form", { name: "New sign-in" });
    const share = within(setUp).getByRole("checkbox", { name: /Share with the team/ });
    expect(share.getAttribute("aria-checked")).toBe("false");
    await user.type(within(setUp).getByRole("textbox", { name: "Name it" }), "Team admin");
    await user.type(
      within(setUp).getByRole("textbox", { name: "The site's sign-in page" }),
      "https://app.example.com/login",
    );
    await user.click(share);
    await user.click(within(setUp).getByRole("button", { name: "Open the sign-in page" }));
    expect(actionOf(api.pageRecordings.startSignIn)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Team admin", shared: true }),
    );
    vi.mocked(window.open).mockRestore();
  });

  test("the owner can share or stop sharing a sign-in; a teammate's shows as a team account", async () => {
    show(
      [],
      [
        {
          _id: "s1",
          name: "My admin",
          url: "https://a.example",
          status: "saved",
          savedAt: 1,
          mine: true,
          shared: false,
        },
        {
          _id: "s3",
          name: "Studio login",
          url: "https://b.example",
          status: "saved",
          savedAt: 1,
          mine: false,
          shared: true,
        },
      ],
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Record the page" }));
    const picker = screen.getByRole("combobox", { name: "Sign in as" });
    await pick(user, picker, "My admin (yours)");
    await user.click(screen.getByRole("button", { name: "Share with the team" }));
    expect(mutationOf(api.pageRecordings.shareSignIn)).toHaveBeenCalledWith({
      signInId: "s1",
      shared: true,
    });
    await pick(user, picker, "Studio login (team account)");
    expect(screen.queryByRole("button", { name: "Share with the team" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove this sign-in" })).toBeNull();
  });
});
