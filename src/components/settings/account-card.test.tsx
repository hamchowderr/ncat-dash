import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/settings/account/account-settings", () => ({
  AccountSettings: () => <p>Profile cards</p>,
}));
vi.mock("@/components/auth/settings/security/security-settings", () => ({
  SecuritySettings: () => <p>Password and device cards</p>,
}));

import { AccountCard } from "./account-card";

describe("AccountCard", () => {
  it("opens on Profile and switches to Password And Devices", async () => {
    render(<AccountCard />);
    expect(screen.getByRole("tablist", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Profile cards")).toBeInTheDocument();
    expect(screen.queryByText("Password and device cards")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Password And Devices" }));
    expect(screen.getByText("Password and device cards")).toBeInTheDocument();
    expect(window.location.search).toContain("tab=security");
  });
});
