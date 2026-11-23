import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { place } from "@/test/convex";

import { ConnectAgent } from "./connect-agent";

const auth = vi.hoisted(() => ({
  session: {
    isPending: false,
    data: {
      user: { id: "u1", email: "maya@salthouse.test" },
      session: { activeOrganizationId: "t1" },
    },
  } as unknown,
  teams: {
    isPending: false,
    data: [
      { id: "t1", name: "Salt House" },
      { id: "t2", name: "Night Shift" },
    ],
  } as unknown,
  setActive: vi.fn(async () => ({ data: {}, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => auth.session,
    useListOrganizations: () => auth.teams,
    organization: { setActive: auth.setActive },
    signOut: vi.fn(async () => undefined),
  },
}));

// The signed request Better Auth sends the person here with.
const SIGNED =
  "response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=s&exp=1&sig=abc";

/** Better Auth's endpoints, as the screen calls them: path to answer. */
function answerAuth(answers: Record<string, unknown>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api\/auth/, "").split("?")[0];
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json(answers[path] ?? { message: "Not found" }, {
        status: path in answers ? 200 : 404,
      });
    }),
  );
  return calls;
}

describe("letting an AI agent in", () => {
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    place.search = SIGNED;
    auth.setActive.mockClear();
    assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { assign, origin: "http://localhost:3000" },
      configurable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    place.search = "";
    auth.session = {
      isPending: false,
      data: {
        user: { id: "u1", email: "maya@salthouse.test" },
        session: { activeOrganizationId: "t1" },
      },
    };
    auth.teams = {
      isPending: false,
      data: [
        { id: "t1", name: "Salt House" },
        { id: "t2", name: "Night Shift" },
      ],
    };
  });

  test("someone signed out is sent to sign in and back here, request and all", () => {
    auth.session = { isPending: false, data: null };
    answerAuth({});
    render(<ConnectAgent step="team" />);
    const href = screen.getByRole("link", { name: "Sign in" }).getAttribute("href") ?? "";
    expect(href.startsWith("/sign-in?redirectTo=")).toBe(true);
    expect(decodeURIComponent(href.split("redirectTo=")[1])).toBe(`/connect/team?${SIGNED}`);
  });

  test("shows who is asking, who is signed in, what it may do, and waits for a team", async () => {
    answerAuth({
      "/oauth2/public-client": { client_name: "Claude", client_uri: "https://claude.ai" },
    });
    render(<ConnectAgent step="team" />);
    expect(
      await screen.findByRole("heading", { name: "Claude wants to connect to your automations" }),
    ).toBeTruthy();
    expect(screen.getByText("maya@salthouse.test")).toBeTruthy();
    const can = screen.getByRole("list", { name: "What it can do" }).textContent ?? "";
    expect(can).toContain("Build and change automations as drafts");
    expect(can).toContain("cannot publish drafts");
    expect(screen.getByText(/Allowing sends you back to/).textContent).toContain("claude.ai");
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("with one team, allowing picks it, allows it and goes back to the agent", async () => {
    auth.teams = { isPending: false, data: [{ id: "t1", name: "Salt House" }] };
    const calls = answerAuth({
      "/oauth2/public-client": { client_name: "Claude" },
      "/oauth2/continue": { redirect: true, url: "/connect?client_id=c1&sig=next" },
      "/oauth2/consent": { redirect: true, url: "https://claude.ai/cb?code=abc" },
    });
    render(<ConnectAgent step="team" />);
    expect(
      await screen.findByRole("heading", { name: "Claude wants to connect to Salt House" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=abc"));
    expect(auth.setActive).toHaveBeenCalledWith({ organizationId: "t1" });
    expect(calls.slice(1)).toEqual([
      { path: "/oauth2/continue", body: { postLogin: true, oauth_query: SIGNED } },
      { path: "/oauth2/consent", body: { accept: true, oauth_query: "client_id=c1&sig=next" } },
    ]);
  });

  test("an agent already allowed on that team goes straight back", async () => {
    auth.teams = { isPending: false, data: [{ id: "t1", name: "Salt House" }] };
    const calls = answerAuth({
      "/oauth2/public-client": { client_name: "Claude" },
      "/oauth2/continue": { redirect: true, url: "https://claude.ai/cb?code=xyz" },
    });
    render(<ConnectAgent step="team" />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=xyz"));
    expect(calls.map((each) => each.path)).not.toContain("/oauth2/consent");
  });

  test("on /connect, the team is the one already picked, and Allow allows it", async () => {
    const calls = answerAuth({
      "/oauth2/public-client": { client_name: "Claude" },
      "/oauth2/consent": { redirect: true, url: "https://claude.ai/cb?code=abc" },
    });
    render(<ConnectAgent step="consent" />);
    expect(
      await screen.findByRole("heading", { name: "Claude wants to connect to Salt House" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Team")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=abc"));
    expect(calls.at(-1)).toEqual({
      path: "/oauth2/consent",
      body: { accept: true, oauth_query: SIGNED },
    });
    expect(auth.setActive).not.toHaveBeenCalled();
  });

  test("cancelling tells the agent no", async () => {
    const calls = answerAuth({
      "/oauth2/public-client": { client_name: "Claude" },
      "/oauth2/consent": { redirect: true, url: "https://claude.ai/cb?error=access_denied" },
    });
    render(<ConnectAgent step="team" />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied"),
    );
    expect(calls.at(-1)).toEqual({
      path: "/oauth2/consent",
      body: { accept: false, oauth_query: SIGNED },
    });
  });

  test("a problem is shown, and the person can try again", async () => {
    auth.teams = { isPending: false, data: [{ id: "t1", name: "Salt House" }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("public-client")
          ? Response.json({ client_name: "Claude" })
          : Response.json({ error_description: "The link has run out." }, { status: 400 }),
      ),
    );
    render(<ConnectAgent step="team" />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByText("The link has run out.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test("a link without Better Auth's signature says to start again from the agent", () => {
    place.search = "client_id=c1";
    answerAuth({});
    render(<ConnectAgent step="team" />);
    expect(screen.getByRole("heading", { name: "This link has expired" })).toBeTruthy();
  });
});
