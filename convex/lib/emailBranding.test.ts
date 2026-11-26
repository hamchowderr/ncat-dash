import { describe, expect, test } from "vitest";

import { emailBranding } from "./emailBranding";

describe("how an email is signed", () => {
  test("names the support inbox from EMAIL_REPLY_TO", () => {
    expect(emailBranding("Takewon", { EMAIL_REPLY_TO: " support@takewon.com " })).toEqual({
      appName: "Takewon",
      supportEmail: "support@takewon.com",
    });
  });

  test("leaves it out when unset or not one plain address", () => {
    expect(emailBranding("Takewon", {})).toEqual({ appName: "Takewon" });
    expect(emailBranding("Takewon", { EMAIL_REPLY_TO: "help, support@x.com" })).toEqual({
      appName: "Takewon",
    });
  });
});
