import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { ClientPicker } from "@/components/automations/client-picker";
import { answerQuery, mutationOf, pushed, replaced } from "@/test/convex";
import { pick, renderInApp, TEAM } from "@/test/render";

import { ClientView } from "./client-view";
import { ClientsView } from "./clients-view";

const client = (over: Record<string, unknown> = {}) => ({
  _id: "k1",
  organizationId: TEAM.id,
  name: "Acme",
  brand: { color: "#FF0000" },
  music: [],
  teamBrand: { color: "#112233", font: "Team Font" },
  teamMusic: [],
  deliveryFolder: "",
  deliversTo: "Clients/Acme/",
  automations: [{ _id: "a1", name: "Weekly shorts", enabled: true }],
  projects: [],
  canDelete: true,
  ...over,
});

describe("the Clients list", () => {
  test("lists clients with what is done for them, and adds one", async () => {
    const user = userEvent.setup();
    answerQuery(api.clients.list, [
      { _id: "k1", name: "Acme", logo: null, color: "#FF0000", automations: 2, projects: 1 },
      { _id: "k2", name: "Bright Co", logo: null, color: null, automations: 0, projects: 0 },
    ]);
    const create = mutationOf(api.clients.create).mockResolvedValue("k3");
    renderInApp(<ClientsView />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/clients/k1");
    expect(within(rows[0]).getByText("1 project")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2 automations")).toBeInTheDocument();
    expect(within(rows[1]).getByText("0 projects")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Client name"), "Carter Media");
    await user.click(screen.getByRole("button", { name: "Add client" }));
    expect(create).toHaveBeenCalledWith({ organizationId: TEAM.id, name: "Carter Media" });
    await waitFor(() =>
      expect(pushed).toHaveBeenCalledWith("/clients/k3", { transitionTypes: ["nav-forward"] }),
    );
  });

  test("explains clients when there are none", () => {
    answerQuery(api.clients.list, []);
    renderInApp(<ClientsView />);
    expect(screen.getByText(/No clients yet/)).toBeInTheDocument();
  });
});

describe("a client's page", () => {
  test("shows its projects, automations, and what its brand falls back to", () => {
    answerQuery(api.clients.get, client());
    answerQuery(api.projects.list, []);
    answerQuery(api.storage.listUploads, []);
    renderInApp(<ClientView clientId={"k1" as never} />);
    expect(screen.getByLabelText("Client name")).toHaveValue("Acme");
    expect(screen.getByRole("link", { name: "New project" })).toHaveAttribute(
      "href",
      "/projects/new?client=k1",
    );
    const automations = screen.getByRole("region", { name: "Automations" });
    expect(within(automations).getByRole("link", { name: /Weekly shorts/ })).toHaveAttribute(
      "href",
      "/automations/a1",
    );
    expect(
      screen.getByText(/uses your team's: colour #112233, font Team Font/),
    ).toBeInTheDocument();
    expect(screen.getByText("Clients/Acme/")).toBeInTheDocument();
  });

  test("its brand saves to the client, not the team", async () => {
    const user = userEvent.setup();
    answerQuery(api.clients.get, client());
    answerQuery(api.projects.list, []);
    answerQuery(api.storage.listUploads, []);
    const setBrand = mutationOf(api.clients.setBrand);
    const teamBrand = mutationOf(api.teamSettings.setBrand);
    renderInApp(<ClientView clientId={"k1" as never} />);
    await user.type(screen.getByLabelText("Font"), "Inter");
    await user.click(screen.getByRole("button", { name: "Save client brand" }));
    expect(setBrand).toHaveBeenCalledWith({
      clientId: "k1",
      brand: { color: "#FF0000", font: "Inter" },
      music: [],
    });
    expect(teamBrand).not.toHaveBeenCalled();
  });

  test("sets a delivery folder, renames, and deletes", async () => {
    const user = userEvent.setup();
    answerQuery(api.clients.get, client());
    answerQuery(api.projects.list, []);
    answerQuery(api.storage.listUploads, []);
    const setFolder = mutationOf(api.clients.setDeliveryFolder);
    const rename = mutationOf(api.clients.rename);
    const remove = mutationOf(api.clients.remove);
    renderInApp(<ClientView clientId={"k1" as never} />);

    const folder = screen.getByLabelText("Folder");
    await user.type(folder, "Deliveries/Acme");
    await user.click(
      within(screen.getByRole("region", { name: "Delivery folder" })).getByRole("button", {
        name: "Save",
      }),
    );
    expect(setFolder).toHaveBeenCalledWith({ clientId: "k1", folder: "Deliveries/Acme" });

    const name = screen.getByLabelText("Client name");
    await user.clear(name);
    await user.type(name, "Acme Studio{Enter}");
    expect(rename).toHaveBeenCalledWith({ clientId: "k1", name: "Acme Studio" });

    await user.click(screen.getByRole("button", { name: "Delete client" }));
    expect(screen.getByText(/Its projects and automations stay/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith({ clientId: "k1" });
    await waitFor(() => expect(replaced).toHaveBeenCalledWith("/clients", expect.anything()));
  });

  test("only owners and admins can delete a client", () => {
    answerQuery(api.clients.get, client({ canDelete: false }));
    answerQuery(api.projects.list, []);
    answerQuery(api.storage.listUploads, []);
    renderInApp(<ClientView clientId={"k1" as never} />);
    expect(screen.queryByRole("button", { name: "Delete client" })).not.toBeInTheDocument();
  });
});

describe("picking a client for an automation", () => {
  test("is hidden until the team has a client", () => {
    answerQuery(api.clients.list, []);
    renderInApp(<ClientPicker automationId={"a1" as never} clientId={null} />);
    expect(screen.queryByLabelText("Client")).not.toBeInTheDocument();
  });

  test("saves the client, or the team itself", async () => {
    const user = userEvent.setup();
    answerQuery(api.clients.list, [{ _id: "k1", name: "Acme" }]);
    const setFor = mutationOf(api.clients.setForAutomation);
    renderInApp(<ClientPicker automationId={"a1" as never} clientId={"k1" as never} />);
    expect(screen.getByLabelText("Client")).toHaveTextContent("Acme");
    await pick(user, screen.getByLabelText("Client"), "Your team");
    expect(setFor).toHaveBeenCalledWith({ automationId: "a1", clientId: null });
  });
});
