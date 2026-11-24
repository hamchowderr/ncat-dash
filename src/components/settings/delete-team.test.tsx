import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, replaced, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { DeleteTeam } from "./delete-team";

const auth = vi.hoisted(() => ({
  remove: vi.fn(async (_args: { organizationId: string }) => ({
    data: {},
    error: null as null | { message: string },
  })),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { organization: { delete: auth.remove } },
}));

function onTeamAs(role: string) {
  answerQuery(api.teams.mine, [{ id: TEAM.id, name: TEAM.name, role }]);
}

describe("deleting the team", () => {
  test("is offered to its owners only", () => {
    onTeamAs("admin");
    const { rerender } = renderInApp(<DeleteTeam />);
    expect(screen.queryByRole("button", { name: "Delete team" })).not.toBeInTheDocument();
    onTeamAs("owner");
    rerender(<DeleteTeam />);
    expect(screen.getByRole("button", { name: "Delete team" })).toBeInTheDocument();
    expect(screen.getByText(/Deletes Salt House and everything in it/)).toBeInTheDocument();
  });

  test("asks for the team's name before deleting, then opens another team", async () => {
    onTeamAs("owner");
    auth.remove.mockClear();
    renderInApp(<DeleteTeam />);
    fireEvent.click(screen.getByRole("button", { name: "Delete team" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete Salt House?");
    expect(dialog).toHaveTextContent(/including the files in its storage/);
    const confirm = screen.getAllByRole("button", { name: "Delete team" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "Salt" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "Salt House" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(auth.remove).toHaveBeenCalledWith({ organizationId: TEAM.id }));
    await waitFor(() => expect(replaced).toHaveBeenCalledWith("/"));
    expect(toastSuccess).toHaveBeenCalledWith("Salt House is deleted.");
  });

  test("says why when the team could not be deleted", async () => {
    onTeamAs("owner");
    auth.remove.mockResolvedValueOnce({
      data: {},
      error: { message: "You are not allowed to delete this organization" },
    });
    renderInApp(<DeleteTeam />);
    fireEvent.click(screen.getByRole("button", { name: "Delete team" }));
    fireEvent.change(await screen.findByLabelText(/to confirm/), {
      target: { value: "Salt House" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete team" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You are not allowed to delete this organization",
    );
    expect(replaced).not.toHaveBeenCalled();
  });
});
