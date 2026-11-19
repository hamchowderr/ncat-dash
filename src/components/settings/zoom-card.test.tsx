import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { ZoomCard } from "./zoom-card";

const empty = { ready: true, me: null, others: [], imports: [] };
const connected = {
  ready: true,
  me: {
    zoomName: "Jordan Lee",
    zoomEmail: "jordan@salthouse.test",
    connectedAt: Date.UTC(2026, 10, 18, 18),
    autoImport: true,
  },
  others: [{ zoomName: "Maya O", memberName: "Maya Ortiz" }],
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

describe("the Zoom card", () => {
  test("says when this dashboard has no Zoom app yet, with nothing to press", () => {
    answerQuery(api.zoom.forTeam, { ...empty, ready: false });
    renderInApp(<ZoomCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("connecting opens Zoom", async () => {
    answerQuery(api.zoom.forTeam, empty);
    const start = mutationOf(api.zoom.startLink);
    start.mockResolvedValue("https://zoom.test/oauth/authorize?state=abc");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/zoom",
      assign,
    } as Location);
    renderInApp(<ZoomCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect Zoom" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://zoom.test/oauth/authorize?state=abc"),
    );
    vi.restoreAllMocks();
  });

  test("shows the account, who else is connected, and what came in", async () => {
    answerQuery(api.zoom.forTeam, connected);
    const setAuto = mutationOf(api.zoom.setAutoImport);
    const disconnect = mutationOf(api.zoom.disconnect);
    renderInApp(<ZoomCard />);
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
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Your Zoom is disconnected"));
  });

  test("lists past recordings and brings one in", async () => {
    answerQuery(api.zoom.forTeam, connected);
    const list = actionOf(api.zoom.pastRecordings);
    list.mockResolvedValue([
      {
        meetingUuid: "m1",
        topic: "Podcast Taping",
        startTime: Date.UTC(2026, 10, 16, 17),
        minutes: 58,
        size: 2_000_000_000,
        brought: false,
      },
      {
        meetingUuid: "m2",
        topic: "Weekly Sync",
        startTime: Date.UTC(2026, 10, 18, 17),
        minutes: 42,
        size: 100,
        brought: true,
      },
    ]);
    const bring = actionOf(api.zoom.bringIn);
    bring.mockResolvedValue("started");
    renderInApp(<ZoomCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show the last 30 days" }));
    expect(await screen.findByText("Podcast Taping")).toBeInTheDocument();
    expect(screen.getByText(/58 min · 1\.9 GB/)).toBeInTheDocument();
    expect(screen.getByText("Brought in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring in" }));
    expect(bring).toHaveBeenCalledWith({ organizationId: TEAM.id, meetingUuid: "m1" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Podcast Taping is on its way to Uploads"),
    );
    expect(screen.getAllByText("Brought in")).toHaveLength(2);
  });

  test("coming back from Zoom says how it went, then tidies the address", async () => {
    window.history.replaceState(null, "", "/settings/zoom?zoom=taken");
    answerQuery(api.zoom.forTeam, empty);
    renderInApp(<ZoomCard />);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That Zoom account is already connected to another team.",
      ),
    );
    expect(window.location.search).toBe("");
  });
});
