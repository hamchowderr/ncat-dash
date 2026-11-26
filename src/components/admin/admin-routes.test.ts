import { describe, expect, test } from "vitest";

import { adminRouteFor } from "./admin-routes";

describe("adminRouteFor", () => {
  test("picks the longest match, so a new email is not Sent Emails", () => {
    expect(adminRouteFor("/admin/emails/new")?.title).toBe("Send An Email");
    expect(adminRouteFor("/admin/emails")?.title).toBe("Sent Emails");
    expect(adminRouteFor("/admin/emails/abc")?.title).toBe("Sent Emails");
    expect(adminRouteFor("/admin/subscribers")?.title).toBe("Subscribers");
    expect(adminRouteFor("/admin/beta")?.title).toBe("Beta Testers");
    expect(adminRouteFor("/files")).toBeUndefined();
  });
});

describe("the bar along the top", () => {
  test("names an Admin page by its own title", async () => {
    const { barTitle } = await import("@/components/app-shell/app-shell");
    expect(barTitle("/admin/emails/new")).toBe("Send An Email");
    expect(barTitle("/admin/subscribers")).toBe("Subscribers");
    expect(barTitle("/files")).toBe("Files");
  });
});
