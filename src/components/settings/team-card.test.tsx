import { api } from "@convex/_generated/api";
import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { TeamCard } from "./team-card";

describe("people on the team", () => {
  test("each shows their photo or initials, and what they do", () => {
    answerQuery(api.teams.people, {
      members: [
        {
          id: "m1",
          userId: "u1",
          role: "owner",
          name: "Maya Ortiz",
          email: "maya@example.test",
          image: null,
          title: "Producer",
        },
        {
          id: "m2",
          userId: "u2",
          role: "member",
          name: "Olu Bello",
          email: "olu@example.test",
          image: "https://example.test/olu.webp",
          title: null,
        },
      ],
      invitations: [],
    });
    answerQuery(api.teams.mine, []);
    renderInApp(<TeamCard canEdit={false} />);
    const list = screen.getByRole("list", { name: "People on the team" });
    const maya = within(list).getByText("Maya Ortiz").closest("li")!;
    expect(maya).toHaveTextContent("· Producer");
    expect(maya).toHaveTextContent("MO");
    expect(within(list).getByText("Olu Bello").closest("li")).not.toHaveTextContent("·");
  });
});
