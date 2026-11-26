import { describe, expect, test } from "vitest";

import { adminRouteFor } from "./admin-routes";

describe("adminRouteFor", () => {
  test("picks the longest match, so a new email is not Sent Emails", () => {
    expect(adminRouteFor("/admin/emails/new")?.title).toBe("Send An Email");
    expect(adminRouteFor("/admin/emails")?.title).toBe("Sent Emails");
    expect(adminRouteFor("/admin/emails/abc")?.title).toBe("Sent Emails");
    expect(adminRouteFor("/admin/subscribers")?.title).toBe("Subscribers");
    expect(adminRouteFor("/files")).toBeUndefined();
  });
});
