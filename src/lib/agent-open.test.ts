import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { showAgent, useAgentOpen } from "./agent-open";

// Whether the agent is open is shared by the shell (which gives it its own column) and the
// pop-up notices (which centre themselves in the space that is left).
describe("whether the agent is open", () => {
  beforeEach(() => localStorage.clear());

  test("starts closed and follows showAgent", () => {
    const { result } = renderHook(() => useAgentOpen());
    expect(result.current).toBe(false);
    act(() => showAgent(true));
    expect(result.current).toBe(true);
    act(() => showAgent(false));
    expect(result.current).toBe(false);
  });

  test("is remembered on this browser", () => {
    showAgent(true);
    const { result } = renderHook(() => useAgentOpen());
    expect(result.current).toBe(true);
  });
});
