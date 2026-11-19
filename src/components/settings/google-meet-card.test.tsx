import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { GoogleMeetCard } from "./google-meet-card";

const empty = { ready: true, me: null, others: [], imports: [] };
const connected = {
  ready: true,
  me: {
    googleName: "Jordan Lee",
    googleEmail: "jordan@salthouse.test",
    connectedAt: Date.UTC(2026, 10, 18, 18),
    autoImport: true,
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
    expect(screen.getByRole("link", { name: "In Uploads" })).toHaveAttribute("href", "/uploads");
    expect(screen.getByText("Did not come in")).toBeInTheDocument();
    expect(screen.getByText(/Connect your toolkit first/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: /Bring in new recordings/ }));
    expect(setAuto).toHaveBeenCalledWith({ organizationId: TEAM.id, autoImport: false });
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Your Google Meet is disconnected"),
    );
  });

  test("lists past recordings and brings one in", async () => {
    answerQuery(api.googleMeet.forTeam, connected);
    const list = actionOf(api.googleMeet.pastRecordings);
    list.mockResolvedValue([
      {
        recordingName: "conferenceRecords/a/recordings/m1",
        topic: "Podcast Taping",
        startTime: Date.UTC(2026, 10, 16, 17),
        minutes: 58,
        size: 2_000_000_000,
        brought: false,
      },
      {
        recordingName: "conferenceRecords/b/recordings/m2",
        topic: "Weekly Sync",
        startTime: Date.UTC(2026, 10, 18, 17),
        minutes: 42,
        size: 100,
        brought: true,
      },
    ]);
    const bring = actionOf(api.googleMeet.bringIn);
    bring.mockResolvedValue("started");
    renderInApp(<GoogleMeetCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show the last 30 days" }));
    expect(await screen.findByText("Podcast Taping")).toBeInTheDocument();
    expect(screen.getByText(/58 min · 1\.9 GB/)).toBeInTheDocument();
    expect(screen.getByText("Brought in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring in" }));
    expect(bring).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      recordingName: "conferenceRecords/a/recordings/m1",
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Podcast Taping is on its way to Uploads"),
    );
    expect(screen.getAllByText("Brought in")).toHaveLength(2);
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
