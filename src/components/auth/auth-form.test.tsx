import { api } from "@convex/_generated/api";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";

import { AuthForm } from "./auth-form";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ isPending: false, data: null }),
    getSession: vi.fn(async () => ({ data: null })),
    signUp: { email: vi.fn() },
    signIn: { email: vi.fn() },
  },
}));

describe("creating an account", () => {
  test("on the hosted dashboard, says it is free for 3 days with no card", () => {
    answerQuery(api.settings.get, { edition: "hosted", trialDays: 3, inviteOnly: false });
    answerQuery(api.email.status, { configured: false });
    render(<AuthForm mode="sign-up" />);
    expect(screen.getByText(/Free for 3 days, with no card needed\./)).toBeTruthy();
    // No card is ever asked for.
    expect(screen.queryByLabelText(/card/i)).toBeNull();
  });

  test("on a self-hosted copy, says nothing about a trial", () => {
    answerQuery(api.settings.get, { edition: "self-hosted", trialDays: null, inviteOnly: false });
    answerQuery(api.email.status, { configured: false });
    render(<AuthForm mode="sign-up" />);
    expect(screen.queryByText(/Free for/)).toBeNull();
    expect(screen.getByText("You will name your team and connect your toolkit next.")).toBeTruthy();
  });

  test("on an invite-only copy, says an invitation is needed", () => {
    answerQuery(api.settings.get, { edition: "self-hosted", trialDays: null, inviteOnly: true });
    answerQuery(api.email.status, { configured: false });
    render(<AuthForm mode="sign-up" />);
    expect(
      screen.getByText(
        "This dashboard is invite-only. Use the email address your invitation went to.",
      ),
    ).toBeTruthy();
  });

  test("signing in never mentions the trial", () => {
    answerQuery(api.settings.get, { edition: "hosted", trialDays: 3, inviteOnly: false });
    answerQuery(api.email.status, { configured: false });
    render(<AuthForm mode="sign-in" />);
    expect(screen.queryByText(/Free for/)).toBeNull();
  });
});
