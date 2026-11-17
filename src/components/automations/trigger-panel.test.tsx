import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { TriggerPanel } from "./trigger-panel";

describe("the Webhook trigger panel", () => {
  test("explains the address in plain words, with no placeholders to type", () => {
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "webhook" }}
        onChange={vi.fn()}
        automationId="auto1"
        hookToken="secret"
      />,
    );
    expect(screen.getByText(/Send a POST here to start a run/)).toBeTruthy();
    expect(screen.getByText(/Anything else you send is kept with the run/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("{{");
    expect(document.body.textContent).not.toContain("trigger.body");
  });
});
