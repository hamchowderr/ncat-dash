import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed, replaced, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { CreatorView } from "./creator-view";
import { CreatorsView } from "./creators-view";
import { rightsStatus } from "./rights";

const TODAY = "2026-11-21";

const creator = (over: Record<string, unknown> = {}) => ({
  _id: "cr1",
  organizationId: TEAM.id,
  name: "Ana Ruiz",
  deals: [
    {
      _id: "d1",
      clientId: "k1",
      client: "Acme",
      endsOn: "2026-11-27",
      usage: "paid",
      note: "Whitelisted on Meta",
      alerted: true,
    },
    {
      _id: "d2",
      clientId: null,
      client: null,
      endsOn: "2027-02-01",
      usage: "organic",
      note: "",
      alerted: false,
    },
  ],
  clients: [
    { _id: "k1", name: "Acme" },
    { _id: "k2", name: "Bright Co" },
  ],
  runs: [
    {
      _id: "r1",
      automationId: "a1",
      automationName: "UGC Ad Variants From Creator Folders",
      status: "done",
      startedAt: Date.parse("2026-11-18T10:00:00Z"),
    },
  ],
  ...over,
});

describe("how a deal's end reads", () => {
  test("says the day and how soon, and marks the ones within a week", () => {
    expect(rightsStatus("2026-11-27", TODAY)).toEqual({
      label: "Last day November 27, 2026, in 6 days",
      tone: "soon",
    });
    expect(rightsStatus("2026-11-21", TODAY).label).toBe("Last day today, November 21, 2026");
    expect(rightsStatus("2026-11-22", TODAY).label).toBe("Last day tomorrow, November 22, 2026");
    expect(rightsStatus("2026-12-01", TODAY).tone).toBe("later");
    expect(rightsStatus("2026-11-01", TODAY)).toEqual({
      label: "Ended November 1, 2026",
      tone: "ended",
    });
  });
});

describe("the Creators list", () => {
  test("lists creators with the deal that ends first, and adds one", async () => {
    answerQuery(api.creators.list, {
      creators: [
        { _id: "cr1", name: "Ana Ruiz", deals: 2, next: { endsOn: "2026-11-27", client: "Acme" } },
        { _id: "cr2", name: "Ben Cole", deals: 0, next: null },
      ],
      seen: ["Dee Moss"],
    });
    const create = mutationOf(api.creators.create).mockResolvedValue("cr3");
    renderInApp(<CreatorsView today={TODAY} />);
    const rows = within(screen.getByRole("list", { name: "Creators" })).getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/creators/cr1");
    expect(
      within(rows[0]).getByText("Acme: Last day November 27, 2026, in 6 days"),
    ).toHaveAttribute("data-tone", "soon");
    expect(within(rows[0]).getByText("2 deals")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No usage rights kept yet")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Creator name"), "Dee Moss");
    await user.click(screen.getByRole("button", { name: "Add creator" }));
    expect(create).toHaveBeenCalledWith({ organizationId: TEAM.id, name: "Dee Moss" });
    await waitFor(() =>
      expect(pushed).toHaveBeenCalledWith("/creators/cr3", { transitionTypes: ["nav-forward"] }),
    );
  });

  test("explains creators when there are none, naming folders already seen", () => {
    answerQuery(api.creators.list, { creators: [], seen: ["Dee Moss"] });
    renderInApp(<CreatorsView today={TODAY} />);
    expect(screen.getByText(/No creators yet/)).toHaveTextContent("Folders seen so far: Dee Moss.");
  });
});

describe("a creator's page", () => {
  test("shows each deal with its client, last day and what it allows, and their runs", () => {
    answerQuery(api.creators.get, creator());
    renderInApp(<CreatorView creatorId={"cr1" as Id<"creators">} today={TODAY} />);
    expect(screen.getByLabelText("Creator name")).toHaveValue("Ana Ruiz");
    const deals = within(screen.getByRole("list", { name: "Deals" })).getAllByRole("listitem");
    expect(deals.map((deal) => deal.getAttribute("data-deal"))).toEqual([
      "Acme",
      "Your own content",
    ]);
    expect(within(deals[0]).getByText("Last day November 27, 2026, in 6 days")).toHaveAttribute(
      "data-tone",
      "soon",
    );
    expect(within(deals[0]).getByText("Paid ads. Whitelisted on Meta")).toBeInTheDocument();
    expect(within(deals[1]).getByText("Organic posts")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Runs" })).getByRole("link", {
        name: /UGC Ad Variants From Creator Folders/,
      }),
    ).toHaveAttribute("href", "/automations/a1/runs/r1");
  });

  test("adds a deal for a client, paid only", async () => {
    answerQuery(api.creators.get, creator({ deals: [], runs: [] }));
    const save = mutationOf(api.creators.saveDeal).mockResolvedValue("d9");
    renderInApp(<CreatorView creatorId={"cr1" as Id<"creators">} today={TODAY} />);
    expect(screen.getByText(/No deals kept yet/)).toBeInTheDocument();
    const user = userEvent.setup();
    const form = screen.getByRole("form", { name: "Add a deal" });
    const add = within(form).getByRole("button", { name: "Add deal" });
    expect(add).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText("Client"), "Bright Co");
    await user.type(within(form).getByLabelText("Last day of use"), "2027-03-31");
    await user.click(within(form).getByRole("radio", { name: "Paid ads" }));
    await user.type(within(form).getByLabelText(/Note/), "TikTok Spark Ads");
    await user.click(add);
    expect(save).toHaveBeenCalledWith({
      creatorId: "cr1",
      dealId: undefined,
      clientId: "k2",
      endsOn: "2027-03-31",
      usage: "paid",
      note: "TikTok Spark Ads",
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deal added"));
  });

  test("changes a deal's last day, removes one, and removes the creator", async () => {
    answerQuery(api.creators.get, creator());
    const save = mutationOf(api.creators.saveDeal);
    const removeDeal = mutationOf(api.creators.removeDeal);
    const remove = mutationOf(api.creators.remove);
    renderInApp(<CreatorView creatorId={"cr1" as Id<"creators">} today={TODAY} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change Acme" }));
    const form = screen.getByRole("form", { name: "Change deal" });
    const day = within(form).getByLabelText("Last day of use");
    await user.clear(day);
    await user.type(day, "2027-05-27");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({
      creatorId: "cr1",
      dealId: "d1",
      clientId: "k1",
      endsOn: "2027-05-27",
      usage: "paid",
      note: "Whitelisted on Meta",
    });

    await user.click(screen.getByRole("button", { name: "Remove Your own content" }));
    expect(removeDeal).toHaveBeenCalledWith({ dealId: "d2" });

    await user.click(screen.getByRole("button", { name: "Remove creator" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith({ creatorId: "cr1" });
    await waitFor(() =>
      expect(replaced).toHaveBeenCalledWith("/creators", { transitionTypes: ["nav-back"] }),
    );
  });

  test("says so when the creator is gone", () => {
    answerQuery(api.creators.get, null);
    renderInApp(<CreatorView creatorId={"cr1" as Id<"creators">} today={TODAY} />);
    expect(screen.getByText("This creator is no longer here.")).toBeInTheDocument();
  });
});
