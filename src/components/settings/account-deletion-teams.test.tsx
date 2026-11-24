import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AccountDeletionTeams } from "./account-deletion-teams";

const team = (name: string) => ({ id: name, name });

describe("what deleting your account does to your teams", () => {
  test("names the team that goes with it and the ones it leaves", () => {
    render(
      <AccountDeletionTeams
        plan={{
          deleteWithYou: [team("Example Studio")],
          leave: [team("Pine Studio"), team("Salt House")],
          handOverFirst: [],
        }}
      />,
    );
    expect(
      screen.getByText(/has nobody else on it, so it is deleted too, with every automation/),
    ).toHaveTextContent("Example Studio");
    expect(screen.getByText(/You leave/)).toHaveTextContent(
      "You leave Pine Studio and Salt House. What you made there stays with the team.",
    );
  });

  test("asks the only owner of a shared team to hand it over first", () => {
    render(
      <AccountDeletionTeams
        plan={{ deleteWithYou: [], leave: [], handOverFirst: [team("Salt House")] }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You are the only owner of Salt House. Make someone else an owner in Settings, Members, or delete the team, before deleting your account.",
    );
  });

  test("says nothing for someone on no team", () => {
    const { container } = render(
      <AccountDeletionTeams plan={{ deleteWithYou: [], leave: [], handOverFirst: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
