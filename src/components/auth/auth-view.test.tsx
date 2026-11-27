import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthUiProvider } from "@/components/auth-ui-provider";
import { authClient } from "@/lib/auth-client";
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
  betaFormUrl: string | null;
  signInWith: { google: boolean };
  emailConfigured: boolean;
  emailVerification: boolean;
};

const base: Settings = {
  edition: "self-hosted",
  trialDays: null,
  inviteOnly: false,
  betaFormUrl: null,
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

  test("on the hosted Takewon in its closed beta, points strangers at the beta form", () => {
    show("signUp", {
      edition: "hosted",
      trialDays: 3,
      inviteOnly: true,
      betaFormUrl: "https://takewon.com/#early",
    });
    expect(screen.getByText(/closed beta/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "join the beta" }).getAttribute("href")).toBe(
      "https://takewon.com/#early",
    );
    // no trial during the beta
    expect(screen.queryByText(/Free for/)).toBeNull();
  });

  test("tells a stranger it's a closed beta before sending anything, and never says it worked", async () => {
    show("signUp", {
      edition: "hosted",
      inviteOnly: true,
      betaFormUrl: "https://takewon.com/#early",
    });
    answerQuery(api.access.signUpAllowed, ({ email }: Record<string, unknown>) =>
      email === "stranger@example.test"
        ? "Takewon is in a closed beta. Join the beta at takewon.com and you'll get an invite by email."
        : null,
    );
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam Lee" } });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "stranger@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "a long enough password 1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/Join the beta at takewon\.com/)).toBeTruthy();
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  test("lets an invited address through to sign up", async () => {
    show("signUp", {
      edition: "hosted",
      inviteOnly: true,
      betaFormUrl: "https://takewon.com/#early",
    });
    answerQuery(api.access.signUpAllowed, null);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Jo Park" } });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "jo@studio.example" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "a long enough password 1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(authClient.signUp.email).toHaveBeenCalledWith(
        expect.objectContaining({ email: "jo@studio.example" }),
      ),
    );
  });

  test("never asks about a newsletter when making an account", () => {
    // Chowderr 2026-11-27: no news or newsletter box on the sign-up page
    show("signUp", { emailConfigured: true });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/news|newsletter/i)).toBeNull();
  });
});
