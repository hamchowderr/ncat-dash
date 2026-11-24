import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { TriggerPanel } from "./trigger-panel";

describe("an upload trigger's choice of running by itself or asking first", () => {
  test("runs by itself unless set to ask, and switches either way", () => {
    const onChange = vi.fn();
    const { rerender } = renderInApp(
      <TriggerPanel
        trigger={{ kind: "upload", fileType: "video", minSeconds: 30 }}
        onChange={onChange}
        automationId="a"
        hookToken="t"
      />,
    );
    const itself = screen.getByRole("radio", { name: "Run by itself" });
    expect(itself.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/You can untick it for one upload under On this upload/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Ask me each time" }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "upload",
      fileType: "video",
      minSeconds: 30,
      ask: true,
    });

    rerender(
      <TriggerPanel
        trigger={{ kind: "upload", fileType: "video", ask: true }}
        onChange={onChange}
        automationId="a"
        hookToken="t"
      />,
    );
    expect(screen.getByText(/It never runs by itself/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Run by itself" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "upload", fileType: "video" });
  });
});
