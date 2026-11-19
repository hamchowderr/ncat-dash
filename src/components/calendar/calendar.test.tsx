import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed } from "@/test/convex";
import { pick, renderInApp, TEAM } from "@/test/render";

import { CalendarView } from "./calendar-view";
import { landing, viewTitle, visibleDays } from "./dates";

// Thursday 19 November 2026, 9:00 in the test machine's own time zone.
const NOW = new Date(2026, 10, 19, 9, 0).getTime();
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).getTime();

const post = (over: Record<string, unknown>) => ({
  _id: "post1",
  title: "Episode 12 teaser",
  platform: "instagram",
  at: local(20, 15, 30),
  queued: false,
  status: "planned",
  fromSlot: false,
  file: null,
  client: null,
  ...over,
});

const due = (over: Record<string, unknown>) => ({
  _id: "slot1",
  label: "Short 1",
  kind: "short",
  status: "in_progress",
  dueAt: local(24, 17),
  project: { _id: "p1", name: "Episode 12" },
  ...over,
});

function answer({
  range = {},
  waiting = {},
  slots = [],
}: {
  range?: Record<string, unknown>;
  waiting?: Record<string, unknown>;
  slots?: unknown[];
} = {}) {
  const asked: Record<string, unknown>[] = [];
  // Convex hands back the same answer until the data changes; so does this stand-in.
  const answers = new Map<string, unknown>();
  answerQuery(api.calendar.range, (args: Record<string, unknown>) => {
    const key = JSON.stringify(args);
    if (!answers.has(key)) {
      asked.push(args);
      answers.set(key, {
        posts: [post({})],
        due: [due({})],
        openSlots: [],
        runs: [],
        repeating: [],
        ...range,
      });
    }
    return answers.get(key);
  });
  answerQuery(api.calendar.waiting, { posts: [], deliverables: [], ...waiting });
  answerQuery(api.calendar.slots, slots);
  answerQuery(api.clients.list, []);
  return asked;
}

const day = (date: number) =>
  document.querySelector<HTMLElement>(`[data-day="2026-11-${String(date).padStart(2, "0")}"]`)!;

beforeEach(() => {
  window.localStorage.clear();
});

describe("calendar dates", () => {
  test("a month shows whole weeks, Sunday first", () => {
    const { days, from, to } = visibleDays("month", new Date(NOW));
    expect(days).toHaveLength(35);
    expect(from).toEqual(new Date(2026, 10, 1));
    expect(to).toEqual(new Date(2026, 11, 6));
    expect(viewTitle("month", new Date(NOW))).toMatch(/November 2026/);
  });

  test("a dropped item keeps its time of day, or takes the hour it is dropped on", () => {
    const target = new Date(2026, 10, 25);
    expect(landing(target, local(20, 15, 30), null, 10)).toBe(local(25, 15, 30));
    expect(landing(target, null, null, 10)).toBe(local(25, 10));
    expect(landing(target, local(20, 15, 30), 8, 10)).toBe(local(25, 8, 30));
  });
});

describe("the Calendar", () => {
  test("asks for the weeks of this month and shows what is planned on its day", () => {
    const asked = answer({
      range: {
        runs: [{ automationId: "a1", name: "Morning digest", at: local(21, 8) }],
        repeating: [{ automationId: "a2", name: "Folder sweep", minutes: 15 }],
        openSlots: [{ slotId: "s1", platform: "tiktok", at: local(23, 10) }],
      },
    });
    renderInApp(<CalendarView now={NOW} />);
    expect(asked[0]).toEqual({
      organizationId: TEAM.id,
      from: new Date(2026, 10, 1).getTime(),
      to: new Date(2026, 11, 6).getTime(),
    });
    expect(screen.getByRole("heading", { name: /November 2026/ })).toBeInTheDocument();
    expect(
      within(day(20)).getByRole("button", { name: /Episode 12 teaser, Instagram at/ }),
    ).toBeInTheDocument();
    expect(
      within(day(24)).getByRole("button", { name: "Short 1 for Episode 12, due" }),
    ).toBeInTheDocument();
    expect(
      within(day(21)).getByRole("button", { name: /Morning digest runs at/ }),
    ).toBeInTheDocument();
    expect(
      within(day(23)).getByRole("button", { name: /Open slot for TikTok/ }),
    ).toBeInTheDocument();
    // A run every 15 minutes shows once on each day from today, not on days gone by.
    expect(
      within(day(19)).getByRole("button", { name: "Folder sweep runs every 15 minutes" }),
    ).toBeInTheDocument();
    expect(within(day(18)).queryByText("Folder sweep")).toBeNull();
  });

  test("moves between months and back to today", async () => {
    const asked = answer();
    renderInApp(<CalendarView now={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Next Month" }));
    expect(screen.getByRole("heading", { name: /December 2026/ })).toBeInTheDocument();
    expect(asked.at(-1)).toMatchObject({ from: new Date(2026, 10, 29).getTime() });
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: /November 2026/ })).toBeInTheDocument();
  });

  test("dragging a post to another day keeps its time; dragging it to the side list takes it off", () => {
    answer();
    renderInApp(<CalendarView now={NOW} />);
    const move = mutationOf(api.calendar.movePost);
    const chip = within(day(20)).getByRole("button", { name: /Episode 12 teaser/ });
    fireEvent.dragStart(chip);
    fireEvent.dragOver(day(26));
    fireEvent.drop(day(26));
    expect(move).toHaveBeenCalledWith({ postId: "post1", at: local(26, 15, 30) });

    fireEvent.dragStart(chip);
    const side = screen.getByRole("complementary", { name: "Side list" });
    expect(within(side).getByText(/Drop here to take it off/)).toBeInTheDocument();
    fireEvent.dragOver(side);
    fireEvent.drop(side);
    expect(move).toHaveBeenLastCalledWith({ postId: "post1", at: null });
  });

  test("dragging from the side list puts a post on the day at 10 and a project slot due that day", () => {
    answer({
      waiting: {
        posts: [post({ _id: "post2", title: "Behind the scenes", at: null, platform: "youtube" })],
        deliverables: [
          due({ _id: "slot2", label: "Episode thumbnail", kind: "thumbnail", dueAt: null }),
        ],
      },
    });
    renderInApp(<CalendarView now={NOW} />);
    const side = screen.getByRole("complementary", { name: "Side list" });
    fireEvent.dragStart(within(side).getByRole("button", { name: /Behind the scenes/ }));
    fireEvent.drop(day(27));
    expect(mutationOf(api.calendar.movePost)).toHaveBeenCalledWith({
      postId: "post2",
      at: local(27, 10),
    });

    fireEvent.dragStart(within(side).getByRole("button", { name: /Episode thumbnail/ }));
    fireEvent.drop(day(30));
    expect(mutationOf(api.calendar.setDue)).toHaveBeenCalledWith({
      deliverableId: "slot2",
      dueAt: local(30, 17),
    });
  });

  test("the week view lays out hours, and dropping on an hour sets it", async () => {
    answer();
    renderInApp(<CalendarView now={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("ncat-dash:calendar-view")).toBe("week");
    const chip = screen.getByRole("button", { name: /Episode 12 teaser/ });
    expect(chip.closest("[data-hour]")).toHaveAttribute("data-hour", "2026-11-20T15");
    fireEvent.dragStart(chip);
    const eight = document.querySelector('[data-hour="2026-11-18T08"]')!;
    fireEvent.drop(eight);
    expect(mutationOf(api.calendar.movePost)).toHaveBeenCalledWith({
      postId: "post1",
      at: local(18, 8, 30),
    });
  });

  test("clicking a post opens it beside the calendar, where it can be marked posted or queued", async () => {
    answer();
    renderInApp(<CalendarView now={NOW} />);
    await userEvent.click(within(day(20)).getByRole("button", { name: /Episode 12 teaser/ }));
    const side = screen.getByRole("complementary", { name: "Side list" });
    expect(within(side).getByLabelText("Title")).toHaveValue("Episode 12 teaser");
    await userEvent.click(within(side).getByRole("button", { name: "Mark Posted" }));
    expect(mutationOf(api.calendar.updatePost)).toHaveBeenCalledWith({
      postId: "post1",
      posted: true,
    });
    mutationOf(api.calendar.queuePost).mockResolvedValue({ placed: true });
    await userEvent.click(within(side).getByRole("button", { name: "Add To Queue" }));
    expect(mutationOf(api.calendar.queuePost)).toHaveBeenCalledWith({ postId: "post1" });
    await userEvent.click(within(side).getByRole("button", { name: "Back" }));
    expect(within(side).getByRole("button", { name: "Not Scheduled" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("adds a post to the queue, or at the time of an open slot that was clicked", async () => {
    answer({ range: { openSlots: [{ slotId: "s1", platform: "tiktok", at: local(23, 10) }] } });
    renderInApp(<CalendarView now={NOW} />);
    const add = mutationOf(api.calendar.addPost);
    add.mockResolvedValue("post9");
    const side = screen.getByRole("complementary", { name: "Side list" });
    await userEvent.click(within(side).getByRole("button", { name: "Add Post" }));
    await userEvent.type(within(side).getByLabelText("Title"), "Clip 4");
    await userEvent.type(within(side).getByLabelText("Library File"), "c12");
    await userEvent.click(within(side).getByRole("button", { name: "Add Post" }));
    expect(add).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      title: "Clip 4",
      platform: "instagram",
      at: null,
      queue: true,
      file: "c12",
    });

    await userEvent.click(within(side).getByRole("button", { name: "Back" }));
    await userEvent.click(within(day(23)).getByRole("button", { name: /Open slot for TikTok/ }));
    expect(within(side).getByLabelText("Where")).toHaveTextContent("TikTok");
    expect(within(side).getByLabelText("Pick A Time")).toBeChecked();
    await userEvent.type(within(side).getByLabelText("Title"), "Teaser");
    await userEvent.click(within(side).getByRole("button", { name: "Add Post" }));
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Teaser",
        platform: "tiktok",
        at: local(23, 10),
        queue: false,
      }),
    );
  });

  test("a scheduled run opens its automation", async () => {
    answer({ range: { runs: [{ automationId: "a1", name: "Morning digest", at: local(21, 8) }] } });
    renderInApp(<CalendarView now={NOW} />);
    await userEvent.click(within(day(21)).getByRole("button", { name: /Morning digest/ }));
    expect(pushed).toHaveBeenCalledWith("/automations/a1");
  });

  test("repeating slots are listed and added in the viewer's own time zone", async () => {
    answer({
      slots: [
        {
          _id: "s1",
          weekday: 1,
          time: "10:00",
          timeZone: "America/Los_Angeles",
          platform: "instagram",
          client: null,
        },
      ],
    });
    renderInApp(<CalendarView now={NOW} />);
    const side = screen.getByRole("complementary", { name: "Side list" });
    await userEvent.click(within(side).getByRole("button", { name: "Repeating Slots" }));
    expect(within(side).getByText("Mondays at 10:00")).toBeInTheDocument();
    const add = mutationOf(api.calendar.addSlot);
    add.mockResolvedValue({ slotId: "s2", placed: 0 });
    await pick(userEvent, within(side).getByLabelText("Day"), "Friday");
    await pick(userEvent, within(side).getByLabelText("Where"), "YouTube");
    await userEvent.click(within(side).getByRole("button", { name: "Add Slot" }));
    expect(add).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      weekday: 5,
      time: "10:00",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: "youtube",
    });
    await userEvent.click(within(side).getByRole("button", { name: "Remove Mondays at 10:00" }));
    expect(mutationOf(api.calendar.removeSlot)).toHaveBeenCalledWith({ slotId: "s1" });
  });

  test("a project slot's due date is set and cleared from its panel", async () => {
    answer();
    renderInApp(<CalendarView now={NOW} />);
    await userEvent.click(within(day(24)).getByRole("button", { name: /Short 1/ }));
    const side = screen.getByRole("complementary", { name: "Side list" });
    expect(within(side).getByRole("link", { name: "Episode 12" })).toHaveAttribute(
      "href",
      "/projects/p1",
    );
    fireEvent.change(within(side).getByLabelText("Due"), { target: { value: "2026-11-28" } });
    expect(mutationOf(api.calendar.setDue)).toHaveBeenCalledWith({
      deliverableId: "slot1",
      dueAt: local(28, 17),
    });
    await userEvent.click(within(side).getByRole("button", { name: "Clear Due Date" }));
    expect(mutationOf(api.calendar.setDue)).toHaveBeenLastCalledWith({
      deliverableId: "slot1",
      dueAt: null,
    });
  });
});
