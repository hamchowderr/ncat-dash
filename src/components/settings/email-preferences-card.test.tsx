import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";

import { EmailPreferencesCard } from "./email-preferences-card";

describe("Email Preferences", () => {
  test("product news starts off, and the switch turns it on", async () => {
    answerQuery(api.news.mine, {
      subscribed: false,
      since: null,
      email: "maya@example.test",
      wording: "",
    });
    const setMine = mutationOf(api.news.setMine);
    render(<EmailPreferencesCard />);
    expect(screen.getByText(/Sent to maya@example.test/)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Product news" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(setMine).toHaveBeenCalledWith({ subscribed: true }));
  });

  test("says since when it has been on, and that account emails always come", () => {
    answerQuery(api.news.mine, {
      subscribed: true,
      since: Date.UTC(2026, 10, 20, 12),
      email: "maya@example.test",
      wording: "",
    });
    render(<EmailPreferencesCard />);
    expect(screen.getByRole("switch", { name: "Product news" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText(/On since/)).toBeTruthy();
    expect(screen.getByText(/can't be switched off/)).toBeTruthy();
  });
});
