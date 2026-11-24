import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthUiProvider } from "@/components/auth-ui-provider";
import { answerQuery, replaced } from "@/test/convex";

import { DangerZone } from "./danger-zone";

/**
 * Delete account, at the foot of Settings > Account > Password And Devices: Better Auth
 * UI's own card, with what happens to each of the person's teams.
 */
const auth = vi.hoisted(() => ({
  // Better Auth UI asks with `throw: true`, so the answer is the data itself.
  deleteUser: vi.fn(async (_body: unknown) => ({ success: true, message: "User deleted" })),
}));

vi.mock("@/lib/auth-client", () => {
  const user = { id: "u1", name: "Maya Ortiz", email: "maya@example.test" };
  const session = { user, session: { id: "s1", userId: "u1", activeOrganizationId: "t1" } };
  return {
    authClient: {
      useSession: () => ({ isPending: false, data: session }),
      getSession: vi.fn(async () => session),
      listAccounts: vi.fn(async () => [
        { id: "a1", providerId: "credential", accountId: "u1", userId: "u1" },
      ]),
      deleteUser: auth.deleteUser,
      $store: { notify: vi.fn(), listen: vi.fn(), atoms: {} },
    },
  };
});

const settings = {
  edition: "hosted",
  trialDays: 3,
  inviteOnly: false,
  signInWith: { google: false },
  emailConfigured: true,
  emailVerification: true,
};

function show(plan: unknown) {
  answerQuery(api.settings.get, settings);
  answerQuery(api.accountDeletion.plan, plan as never);
  return render(
    <AuthUiProvider>
      <DangerZone />
    </AuthUiProvider>,
  );
}

const team = (name: string) => ({ id: name, name });

beforeEach(() => auth.deleteUser.mockClear());

describe("deleting your account", () => {
  test("asks for the password, says what happens to each team, then signs out", async () => {
    show({
      deleteWithYou: [team("Example Studio")],
      leave: [team("Pine Studio")],
      handOverFirst: [],
    });
    const open = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Example Studio has nobody else on it, so it is deleted too/);
    expect(dialog).toHaveTextContent(/You leave Pine Studio/);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete account" }).at(-1)!);
    await waitFor(() =>
      expect(auth.deleteUser).toHaveBeenCalledWith(
        expect.objectContaining({ password: "correct horse" }),
      ),
    );
    await waitFor(() => expect(replaced).toHaveBeenCalledWith("/sign-in"));
  });

  test("can't start while the person is the only owner of a team others are on", async () => {
    show({ deleteWithYou: [], leave: [], handOverFirst: [team("Salt House")] });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You are the only owner of Salt House.",
    );
    expect(screen.getByRole("button", { name: "Delete account" })).toBeDisabled();
  });
});
