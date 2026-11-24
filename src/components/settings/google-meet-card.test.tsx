import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { openTab, renderInApp, TEAM } from "@/test/render";

import { GoogleMeetCard } from "./google-meet-card";

const empty = { ready: true, me: null, others: [], imports: [] };
const connected = {
  ready: true,
  me: {
    googleName: "Jordan Lee",
    googleEmail: "jordan@salthouse.test",
    connectedAt: Date.UTC(2026, 10, 18, 18),
    autoImport: true,
    includeShared: false,
    signInLost: false,
  },
  others: [{ googleName: "Maya O", memberName: "Maya Ortiz" }],
  imports: [
    {
      _id: "i1",
      topic: "Weekly Sync",
      startTime: Date.UTC(2026, 10, 18, 17),
      status: "done",
      error: null,
    },
    {
      _id: "i2",
      topic: "Client Kickoff",
      startTime: Date.UTC(2026, 10, 17, 17),
      status: "failed",
      error: "Connect your toolkit first, so there is somewhere for recordings to go.",
    },
  ],
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the Google Meet card", () => {
  test("says when this dashboard has no Google app yet, with nothing to press", () => {
    answerQuery(api.googleMeet.forTeam, { ...empty, ready: false });
    renderInApp(<GoogleMeetCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("connecting opens Google", async () => {
    answerQuery(api.googleMeet.forTeam, empty);
    const start = mutationOf(api.googleMeet.startLink);
    start.mockResolvedValue("https://accounts.google.test/o/oauth2/v2/auth?state=abc");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/google-meet",
      assign,
    } as Location);
    renderInApp(<GoogleMeetCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect Google Meet" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://accounts.google.test/o/oauth2/v2/auth?state=abc",
      ),
    );
    vi.restoreAllMocks();
  });

  test("shows the account, who else is connected, and what came in", async () => {
    answerQuery(api.googleMeet.forTeam, connected);
    const setAuto = mutationOf(api.googleMeet.setAutoImport);
    const disconnect = mutationOf(api.googleMeet.disconnect);
    renderInApp(<GoogleMeetCard />);
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByText(/Maya Ortiz \(Maya O\)/)).toBeInTheDocument();
    // What came in sits with the past recordings, a tab away from the connection.
    await openTab("Past Recordings");
    expect(screen.getByRole("link", { name: "In the Library" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.getByText("Did not come in")).toBeInTheDocument();
    expect(screen.getByText(/Connect your toolkit first/)).toBeInTheDocument();
    await openTab("Connection");

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: /Bring in new recordings/ }));
    expect(setAuto).toHaveBeenCalledWith({ organizationId: TEAM.id, autoImport: false });
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Your Google Meet is disconnected"),
    );
  });

  test("finds every recording, says how many are new, and brings the picked ones over at once", async () => {
    answerQuery(api.googleMeet.forTeam, connected);
    const scan = actionOf(api.googleMeet.pastRecordings);
    const recording = (driveFileId: string, topic: string, standing: string, year: number) => ({
      driveFileId,
      topic,
      startTime: new Date(year, 5, 16, 10).getTime(),
      minutes: 58,
      size: 2_000_000_000,
      standing,
    });
    const thisYear = new Date().getFullYear();
    scan.mockResolvedValueOnce({
      recordings: [
        recording("fileOne", "Podcast Taping", "new", thisYear),
        recording("fileTwo", "Weekly Sync", "brought", thisYear),
        recording("fileThree", "Client Call", "duplicate", thisYear),
        recording("fileOld", "Kickoff", "new", thisYear - 1),
        recording("fileOlder", "Strategy Day", "new", thisYear - 1),
      ],
      complete: true,
    });
    scan.mockResolvedValueOnce({
      recordings: [
        recording("fileOne", "Podcast Taping", "brought", thisYear),
        recording("fileTwo", "Weekly Sync", "brought", thisYear),
        recording("fileThree", "Client Call", "duplicate", thisYear),
        recording("fileOld", "Kickoff", "brought", thisYear - 1),
        recording("fileOlder", "Strategy Day", "new", thisYear - 1),
      ],
      complete: true,
    });
    const bring = actionOf(api.googleMeet.bringIn);
    // One of the two was taken by the watcher in the meantime: it is on its way all the same.
    bring.mockResolvedValue({ started: 1, already: 1, duplicate: 0, missing: 0 });
    renderInApp(<GoogleMeetCard />);
    const user = userEvent.setup();
    await openTab("Past Recordings");
    expect(screen.getByText(/however old/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Find recordings" }));
    expect(
      await screen.findByText("5 recordings in your Drive. 3 not in the Library yet."),
    ).toBeInTheDocument();
    // Grouped by year, the newest open; the ones already in are said so and cannot be picked.
    expect(screen.getByRole("group", { name: String(thisYear - 1) })).toBeInTheDocument();
    expect(screen.getByText("Brought in")).toBeInTheDocument();
    expect(screen.getByText("Already in the Library")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: /^Pick .*,/ })).toHaveLength(1);
    const lastYear = screen.getByRole("button", {
      name: `${thisYear - 1} · 2 recordings · 2 picked`,
    });
    expect(lastYear).toHaveAttribute("aria-expanded", "false");
    await user.click(lastYear);
    expect(screen.getAllByRole("checkbox", { name: /^Pick .*,/ })).toHaveLength(3);
    // Everything new is picked to start with.
    expect(screen.getByText("All 3 picked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bring over 3 recordings" })).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: /^Pick Strategy Day/ }));
    expect(screen.getByText("2 of 3 picked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring over 2 recordings" }));
    expect(bring).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      driveFileIds: ["fileOne", "fileOld"],
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("2 recordings on the way to the Library"),
    );
    // Looked through again: only the one left out is still to bring over.
    expect(
      await screen.findByText("5 recordings in your Drive. 1 not in the Library yet."),
    ).toBeInTheDocument();
  });

  test("picking by year, and unpicking everything, leaves nothing to bring over", async () => {
    answerQuery(api.googleMeet.forTeam, connected);
    const thisYear = new Date().getFullYear();
    actionOf(api.googleMeet.pastRecordings).mockResolvedValue({
      recordings: [
        {
          driveFileId: "fileOne",
          topic: "Podcast Taping",
          startTime: new Date(thisYear, 1, 3).getTime(),
          minutes: 58,
          size: 100,
          standing: "new",
        },
        {
          driveFileId: "fileOld",
          topic: "Kickoff",
          startTime: new Date(thisYear - 1, 1, 3).getTime(),
          minutes: 20,
          size: 200,
          standing: "new",
        },
      ],
      complete: false,
    });
    renderInApp(<GoogleMeetCard />);
    const user = userEvent.setup();
    await openTab("Past Recordings");
    await user.click(screen.getByRole("button", { name: "Find recordings" }));
    expect(await screen.findByText(/Showing the newest 2,000/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", {
        name: `Pick every ${thisYear - 1} recording not in the Library`,
      }),
    );
    expect(screen.getByText("1 of 2 picked")).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "Pick every recording not in the Library" }),
    );
    expect(screen.getByText("All 2 picked")).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "Pick every recording not in the Library" }),
    );
    expect(screen.getByText("0 of 2 picked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bring over 0 recordings" })).toBeDisabled();
  });

  test("recordings shared with you: a switch to bring them in too, and who shared each", async () => {
    answerQuery(api.googleMeet.forTeam, connected);
    const setShared = mutationOf(api.googleMeet.setIncludeShared);
    actionOf(api.googleMeet.pastRecordings).mockResolvedValue({
      recordings: [
        {
          driveFileId: "sharedFile",
          topic: "Tylan / Andrew",
          startTime: Date.UTC(2025, 3, 23, 19),
          minutes: 21,
          size: 127_000_000,
          standing: "new",
          sharedBy: "Andrew Fink",
        },
      ],
      complete: true,
    });
    renderInApp(<GoogleMeetCard />);
    const user = userEvent.setup();
    const shared = screen.getByRole("switch", { name: /recordings shared with you/ });
    expect(shared).not.toBeChecked();
    await user.click(shared);
    expect(setShared).toHaveBeenCalledWith({ organizationId: TEAM.id, includeShared: true });
    await openTab("Past Recordings");
    await user.click(screen.getByRole("button", { name: "Find recordings" }));
    expect(
      await screen.findByText(
        "1 recording in your Drive, 1 shared with you. 1 not in the Library yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Shared with you", { selector: "[data-slot=badge]" })).toBeVisible();
    expect(screen.getByText(/from Andrew Fink/)).toBeInTheDocument();
  });

  test("with bringing in switched off, the shared switch is not offered", async () => {
    answerQuery(api.googleMeet.forTeam, {
      ...connected,
      me: { ...connected.me, autoImport: false },
    });
    renderInApp(<GoogleMeetCard />);
    expect(screen.queryByRole("switch", { name: /recordings shared with you/ })).toBeNull();
  });

  test("coming back from Google says how it went, then tidies the address", async () => {
    window.history.replaceState(null, "", "/settings/google-meet?meet=missing_access");
    answerQuery(api.googleMeet.forTeam, empty);
    renderInApp(<GoogleMeetCard />);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Google did not allow everything needed. Connect again and leave every box ticked.",
      ),
    );
    expect(window.location.search).toBe("");
  });

  test("when Google stopped accepting the sign-in, says so and offers to connect again", async () => {
    answerQuery(api.googleMeet.forTeam, {
      ...connected,
      me: { ...connected.me, signInLost: true },
    });
    const start = mutationOf(api.googleMeet.startLink);
    start.mockResolvedValue("https://accounts.google.test/o/oauth2/v2/auth?state=again");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/google-meet",
      assign,
    } as Location);
    renderInApp(<GoogleMeetCard />);
    expect(screen.getByText(/Google stopped accepting this sign-in/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect Google Meet again" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://accounts.google.test/o/oauth2/v2/auth?state=again",
      ),
    );
    vi.restoreAllMocks();
  });
});
