import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf, routeParams } from "@/test/convex";

import { ConnectAgent } from "./connect-agent";

const session = vi.hoisted(() => ({
  value: {
    isPending: false,
    data: { user: { id: "u1", email: "maya@salthouse.test" } },
  } as unknown,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => session.value, signOut: vi.fn(async () => undefined) },
}));

const OPEN = {
  status: "open",
  clientName: "Claude",
  clientHost: "claude.ai",
  redirectHost: "claude.ai",
  teams: [
    { id: "t1", name: "Salt House", role: "owner" },
    { id: "t2", name: "Night Shift", role: "member" },
  ],
};

describe("letting an AI agent in", () => {
  beforeEach(() => {
    routeParams.requestId = "r1";
    session.value = {
      isPending: false,
      data: { user: { id: "u1", email: "maya@salthouse.test" } },
    };
  });

  test("someone signed out is sent to sign in and back here", () => {
    session.value = { isPending: false, data: null };
    answerQuery(api.oauth.request, { status: "signed-out" });
    render(<ConnectAgent />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/sign-in?redirectTo=%2Fconnect%2Fr1",
    );
  });

  test("shows who is asking, who is signed in, what it may do, and waits for a team", () => {
    answerQuery(api.oauth.request, OPEN);
    render(<ConnectAgent />);
    expect(
      screen.getByRole("heading", { name: "Claude wants to connect to your automations" }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "Claude" })).toBeTruthy();
    expect(screen.getByText("maya@salthouse.test")).toBeTruthy();
    const can = screen.getByRole("list", { name: "What it can do" }).textContent ?? "";
    expect(can).toContain("Build and change automations as drafts");
    expect(can).toContain("cannot publish drafts");
    expect(screen.getByText(/Allowing sends you back to/).textContent).toContain("claude.ai");
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("with one team, allows straight away and goes back to the agent", async () => {
    answerQuery(api.oauth.request, { ...OPEN, teams: [OPEN.teams[0]] });
    const decide = mutationOf(api.oauth.decide);
    decide.mockResolvedValueOnce({ redirectTo: "https://claude.ai/cb?code=abc" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    render(<ConnectAgent />);
    expect(
      screen.getByRole("heading", { name: "Claude wants to connect to Salt House" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=abc"));
    expect(decide).toHaveBeenCalledWith({ requestId: "r1", allow: true, organizationId: "t1" });
  });

  test("cancelling tells the agent no", async () => {
    answerQuery(api.oauth.request, OPEN);
    const decide = mutationOf(api.oauth.decide);
    decide.mockResolvedValueOnce({ redirectTo: "https://claude.ai/cb?error=access_denied" });
    Object.defineProperty(window, "location", { value: { assign: vi.fn() }, configurable: true });
    render(<ConnectAgent />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith({ requestId: "r1", allow: false }));
  });

  test("an expired link says to start again from the agent", () => {
    answerQuery(api.oauth.request, { status: "gone" });
    render(<ConnectAgent />);
    expect(screen.getByRole("heading", { name: "This link has expired" })).toBeTruthy();
  });
});
