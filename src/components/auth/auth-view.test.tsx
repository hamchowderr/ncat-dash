import { api } from "@convex/_generated/api";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthUiProvider } from "@/components/auth-ui-provider";
import { answerQuery, replaced } from "@/test/convex";

import { AuthView } from "./auth-view";

const session = vi.hoisted(() => ({ data: null as null | { user: { id: string } } }));

vi.mock("@/lib/auth-client", () => {
  const getSession = vi.fn(async () => ({ data: session.data, error: null }));
  return {
    authClient: {
      useSession: () => ({ isPending: false, data: session.data }),
      getSession,
      signUp: { email: vi.fn() },
      signIn: { email: vi.fn(), social: vi.fn() },
      $store: { notify: vi.fn(), listen: vi.fn(), atoms: {} },
    },
  };
});

type Settings = {
  edition: string;
  trialDays: number | null;
  inviteOnly: boolean;
  signInWith: { google: boolean };
  emailConfigured: boolean;
  emailVerification: boolean;
};

const base: Settings = {
  edition: "self-hosted",
  trialDays: null,
  inviteOnly: false,
  signInWith: { google: false },
  emailConfigured: false,
  emailVerification: false,
};

function show(view: "signIn" | "signUp", settings: Partial<Settings> = {}) {
  answerQuery(api.settings.get, { ...base, ...settings });
  return render(
    <AuthUiProvider>
      <AuthView view={view} />
    </AuthUiProvider>,
  );
}

beforeEach(() => {
  session.data = null;
});

describe("signing in", () => {
  test("is titled with the product's name and asks for email and password", () => {
    show("signIn");
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to Takewon" })).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("offers Google only once its keys are set", () => {
    const { unmount } = show("signIn");
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
    unmount();
    show("signIn", { signInWith: { google: true } });
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeTruthy();
  });

  test("offers a password reset only when the dashboard can send email", () => {
    const { unmount } = show("signIn");
    expect(screen.queryByText("Forgot password?")).toBeNull();
    unmount();
    show("signIn", { emailConfigured: true });
    expect(screen.getByText("Forgot password?")).toBeTruthy();
  });

  test("sends someone already signed in on", async () => {
    session.data = { user: { id: "u1" } };
    show("signIn");
    await waitFor(() => expect(replaced).toHaveBeenCalledWith("/"));
  });
});

describe("creating an account", () => {
  test("on the hosted dashboard, says it is free for 3 days with no card", () => {
    show("signUp", { edition: "hosted", trialDays: 3 });
    expect(
      screen.getByRole("heading", { level: 1, name: "Create your Takewon account" }),
    ).toBeTruthy();
    expect(screen.getByText(/Free for 3 days, with no card needed\./)).toBeTruthy();
    expect(screen.queryByLabelText(/card/i)).toBeNull();
  });

  test("on a self-hosted copy, says nothing about a trial", () => {
    show("signUp");
    expect(screen.queryByText(/Free for/)).toBeNull();
  });

  test("on an invite-only copy, says an invitation is needed", () => {
    show("signUp", { inviteOnly: true });
    expect(screen.getByText(/invite-only/)).toBeTruthy();
  });
});
