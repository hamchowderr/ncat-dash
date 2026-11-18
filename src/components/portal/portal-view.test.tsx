import { api } from "@convex/_generated/api";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed } from "@/test/convex";

import { PortalProject, PortalView } from "./portal-view";

const TOKEN = "a".repeat(64);

const view = (over: Record<string, unknown> = {}) => ({
  agency: { name: "Salt House", logo: null, color: "#FFCC00" },
  client: { name: "Acme" },
  projects: [
    {
      _id: "p1",
      name: "Episode 12",
      package: "Video podcast",
      cover: null,
      total: 7,
      ready: 2,
      approved: 1,
      updatedAt: 0,
    },
    {
      _id: "p2",
      name: "Launch",
      package: "Batch of shorts",
      cover: null,
      total: 4,
      ready: 0,
      approved: 4,
      updatedAt: 0,
    },
  ],
  ...over,
});

describe("a client's portal", () => {
  test("shows the client's projects under the agency's name, in its colour", () => {
    answerQuery(api.portal.view, view());
    const { container } = render(<PortalView token={TOKEN} />);
    expect(screen.getByRole("heading", { name: "Projects for Acme" })).toBeInTheDocument();
    expect(screen.getByText("Salt House")).toBeInTheDocument();
    // Its colour, with dark writing on a light yellow.
    const frame = container.querySelector("[style]") as HTMLElement;
    expect(frame.style.getPropertyValue("--brand")).toBe("#FFCC00");
    expect(frame.style.getPropertyValue("--brand-ink")).toBe("#000000");

    const rows = screen.getAllByRole("link");
    expect(rows[0]).toHaveAttribute("href", `/portal/${TOKEN}/p1`);
    expect(within(rows[0]).getByText("2 ready for you")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/1 piece approved of 7/)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/ready for you/)).not.toBeInTheDocument();
  });

  test("says so when the link no longer works", () => {
    answerQuery(api.portal.view, null);
    render(<PortalView token={TOKEN} />);
    expect(screen.getByText("This link no longer works")).toBeInTheDocument();
  });

  test("a project shows each piece in plain words, and opens its review room", async () => {
    const user = userEvent.setup();
    answerQuery(api.portal.view, view());
    answerQuery(api.portal.project, {
      _id: "p1",
      name: "Episode 12",
      package: "Video podcast",
      hasReview: true,
      slots: [
        {
          _id: "s1",
          kind: "video",
          label: "Full episode",
          status: "review",
          url: "https://f.example/ep.mp4",
          versions: 1,
        },
        {
          _id: "s2",
          kind: "thumbnail",
          label: "Episode thumbnail",
          status: "todo",
          url: null,
          versions: 0,
        },
      ],
    });
    const openReview = mutationOf(api.portal.openReview).mockResolvedValue("b".repeat(64));
    render(<PortalProject token={TOKEN} projectId="p1" />);
    const pieces = screen.getAllByRole("listitem");
    expect(within(pieces[0]).getByText("Ready for you")).toBeInTheDocument();
    expect(pieces[0].querySelector("video")).toHaveAttribute("src", "https://f.example/ep.mp4");
    expect(within(pieces[1]).getByText("Not started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All projects" })).toHaveAttribute(
      "href",
      `/portal/${TOKEN}`,
    );

    await user.click(screen.getByRole("button", { name: "Review and comment" }));
    expect(openReview).toHaveBeenCalledWith({ token: TOKEN, projectId: "p1" });
    await waitFor(() =>
      expect(pushed).toHaveBeenCalledWith(
        `/share/${"b".repeat(64)}?back=${encodeURIComponent(`/portal/${TOKEN}/p1`)}`,
      ),
    );
  });

  test("a project with nothing to review yet has no review button; another's is not shown", () => {
    answerQuery(api.portal.view, view());
    answerQuery(api.portal.project, {
      _id: "p1",
      name: "Episode 12",
      package: "Video podcast",
      hasReview: false,
      slots: [],
    });
    const { unmount } = render(<PortalProject token={TOKEN} projectId="p1" />);
    expect(screen.queryByRole("button", { name: "Review and comment" })).not.toBeInTheDocument();
    unmount();
    answerQuery(api.portal.project, null);
    render(<PortalProject token={TOKEN} projectId="p9" />);
    expect(screen.getByText("This project is not shared here.")).toBeInTheDocument();
  });
});
