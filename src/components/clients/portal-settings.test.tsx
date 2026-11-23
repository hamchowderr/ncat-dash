import { api } from "@convex/_generated/api";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { PortalSettings } from "./portal-settings";

const TOKEN = "c".repeat(64);

describe("a client's portal settings", () => {
  test("makes the link with the chosen settings", async () => {
    const user = userEvent.setup();
    answerQuery(api.portal.forClient, null);
    const set = mutationOf(api.portal.set);
    renderInApp(<PortalSettings clientId={"k1" as never} />);
    expect(screen.queryByLabelText("Portal link")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Show the team's comments" }));
    await user.click(screen.getByRole("button", { name: "Make the portal link" }));
    expect(set).toHaveBeenCalledWith({
      clientId: "k1",
      allowVerdict: true,
      showTeamComments: true,
    });
  });

  test("shows the link once on, saves changes at once, and switches off", async () => {
    const user = userEvent.setup();
    answerQuery(api.portal.forClient, {
      token: TOKEN,
      allowVerdict: true,
      showTeamComments: false,
    });
    const set = mutationOf(api.portal.set);
    const stop = mutationOf(api.portal.stop);
    renderInApp(<PortalSettings clientId={"k1" as never} />);
    expect(screen.getByLabelText("Portal link")).toHaveValue(
      `${window.location.origin}/portal/${TOKEN}`,
    );
    await user.click(screen.getByRole("switch", { name: "Let them approve" }));
    expect(set).toHaveBeenCalledWith({
      clientId: "k1",
      allowVerdict: false,
      showTeamComments: false,
    });
    await user.click(screen.getByRole("button", { name: "Switch off the portal" }));
    expect(stop).toHaveBeenCalledWith({ clientId: "k1" });
  });

  test("makes a new link that turns the old one off", async () => {
    const user = userEvent.setup();
    answerQuery(api.portal.forClient, {
      token: TOKEN,
      allowVerdict: true,
      showTeamComments: false,
    });
    const newLink = mutationOf(api.portal.newLink);
    renderInApp(<PortalSettings clientId={"k1" as never} />);
    expect(screen.getByText(/A new link turns this one off straight away/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Make a new link" }));
    expect(newLink).toHaveBeenCalledWith({ clientId: "k1" });
  });

  test("offers no new link before the portal is on", () => {
    answerQuery(api.portal.forClient, null);
    renderInApp(<PortalSettings clientId={"k1" as never} />);
    expect(screen.queryByRole("button", { name: "Make a new link" })).toBeNull();
  });
});
