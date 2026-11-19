import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { MicrosoftCard } from "./microsoft-card";

const empty = { ready: true, me: null, others: [], imports: [] };
const connected = {
  ready: true,
  me: {
    msName: "Jordan Lee",
    msEmail: "jordan@salthouse.test",
    connectedAt: Date.UTC(2026, 10, 18, 18),
    autoImport: true,
    needsReconnect: false,
    includeShared: false,
    sharedGranted: false,
  },
  others: [{ msName: "Maya O", memberName: "Maya Ortiz" }],
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

describe("the Microsoft 365 card", () => {
  test("says when this dashboard has no Microsoft app yet, with nothing to press", () => {
    answerQuery(api.microsoft.forTeam, { ...empty, ready: false });
    renderInApp(<MicrosoftCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("connecting opens Microsoft", async () => {
    answerQuery(api.microsoft.forTeam, empty);
    const start = mutationOf(api.microsoft.startLink);
    start.mockResolvedValue("https://login.test/common/oauth2/v2.0/authorize?state=abc");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/microsoft",
      assign,
    } as Location);
    renderInApp(<MicrosoftCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect Microsoft 365" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://login.test/common/oauth2/v2.0/authorize?state=abc",
      ),
    );
    vi.restoreAllMocks();
  });

  test("shows the account, who else is connected, and what came in", async () => {
    answerQuery(api.microsoft.forTeam, connected);
    const setAuto = mutationOf(api.microsoft.setAutoImport);
    const disconnect = mutationOf(api.microsoft.disconnect);
    renderInApp(<MicrosoftCard />);
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
      expect(toastSuccess).toHaveBeenCalledWith("Your Microsoft account is disconnected"),
    );
  });

  test("lists past recordings and brings one in", async () => {
    answerQuery(api.microsoft.forTeam, connected);
    const list = actionOf(api.microsoft.pastRecordings);
    list.mockResolvedValue([
      {
        itemId: "m1",
        topic: "Podcast Taping",
        startTime: Date.UTC(2026, 10, 16, 17),
        minutes: 58,
        size: 2_000_000_000,
        shared: false,
        brought: false,
      },
      {
        itemId: "m2",
        topic: "Weekly Sync",
        startTime: Date.UTC(2026, 10, 18, 17),
        minutes: 42,
        size: 100,
        shared: false,
        brought: true,
      },
    ]);
    const bring = actionOf(api.microsoft.bringIn);
    bring.mockResolvedValue("started");
    renderInApp(<MicrosoftCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show the last 30 days" }));
    expect(await screen.findByText("Podcast Taping")).toBeInTheDocument();
    expect(screen.getByText(/58 min · 1\.9 GB/)).toBeInTheDocument();
    expect(screen.getByText("Brought in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring in" }));
    expect(bring).toHaveBeenCalledWith({ organizationId: TEAM.id, itemId: "m1" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Podcast Taping is on its way to Uploads"),
    );
    expect(screen.getAllByText("Brought in")).toHaveLength(2);
  });

  test("coming back from Microsoft says how it went, then tidies the address", async () => {
    window.history.replaceState(null, "", "/settings/microsoft?microsoft=taken");
    answerQuery(api.microsoft.forTeam, empty);
    renderInApp(<MicrosoftCard />);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That Microsoft account is already connected to another team.",
      ),
    );
    expect(window.location.search).toBe("");
  });

  test("a sign-in Microsoft stopped accepting offers to connect again", async () => {
    answerQuery(api.microsoft.forTeam, {
      ...connected,
      me: { ...connected.me, needsReconnect: true },
    });
    const start = mutationOf(api.microsoft.startLink);
    start.mockResolvedValue("https://login.test/again");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/microsoft",
      assign,
    } as Location);
    renderInApp(<MicrosoftCard />);
    expect(screen.getByText(/stopped accepting your sign-in/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect again" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.test/again"));
    vi.restoreAllMocks();
  });

  test("meetings shared with me: the first time asks Microsoft, after that it is a switch", async () => {
    answerQuery(api.microsoft.forTeam, connected);
    const start = mutationOf(api.microsoft.startLink);
    start.mockResolvedValue("https://login.test/shared");
    const setShared = mutationOf(api.microsoft.setIncludeShared);
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/microsoft",
      assign,
    } as Location);
    const { unmount } = renderInApp(<MicrosoftCard />);
    const user = userEvent.setup();
    const shared = screen.getByRole("switch", { name: /Also bring in meetings shared with me/ });
    expect(shared).not.toBeChecked();
    expect(screen.getByText(/other people's Teams meetings you were in/)).toBeInTheDocument();
    await user.click(shared);
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, shared: true });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.test/shared"));
    expect(setShared).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    unmount();

    // Allowed already: switching it off and on needs no sign-in.
    answerQuery(api.microsoft.forTeam, {
      ...connected,
      me: { ...connected.me, includeShared: true, sharedGranted: true },
    });
    renderInApp(<MicrosoftCard />);
    const on = screen.getByRole("switch", { name: /Also bring in meetings shared with me/ });
    expect(on).toBeChecked();
    await user.click(on);
    expect(setShared).toHaveBeenCalledWith({ organizationId: TEAM.id, includeShared: false });
  });

  test("a shared recording is marked as shared, and brought in from its own OneDrive", async () => {
    answerQuery(api.microsoft.forTeam, {
      ...connected,
      me: { ...connected.me, includeShared: true, sharedGranted: true },
    });
    actionOf(api.microsoft.pastRecordings).mockResolvedValue([
      {
        itemId: "s1",
        driveId: "drive-ana",
        shared: true,
        topic: "Board Review",
        startTime: Date.UTC(2026, 10, 17, 16),
        minutes: 30,
        size: 3_000_000,
        brought: false,
      },
    ]);
    const bring = actionOf(api.microsoft.bringIn);
    bring.mockResolvedValue("started");
    renderInApp(<MicrosoftCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show the last 30 days" }));
    expect(await screen.findByText(/Shared with you/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring in" }));
    expect(bring).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      itemId: "s1",
      driveId: "drive-ana",
    });
  });

  test("coming back after allowing shared files says so", async () => {
    window.history.replaceState(null, "", "/settings/microsoft?microsoft=shared");
    answerQuery(api.microsoft.forTeam, empty);
    renderInApp(<MicrosoftCard />);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Meetings shared with you now come in too"),
    );
  });
});
