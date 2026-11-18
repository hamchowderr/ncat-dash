import { api } from "@convex/_generated/api";
import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { EmailCard } from "./email-card";

const email = {
  configured: true,
  canEdit: false,
  source: "deployment",
  fromEmail: "clips@example.test",
  fromName: "Salt House",
};

describe("the email card", () => {
  test("shows how email is sent and points to Notifications for what each person gets", () => {
    answerQuery(api.email.get, email);
    renderInApp(<EmailCard />);
    expect(screen.getByText("Salt House (clips@example.test)")).toBeInTheDocument();
    // The per-person switches moved to the Notifications card.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
  });
});
