import { describe, expect, test } from "vitest";
import { AUTOMATION_FILE_FORMAT, AUTOMATION_FILE_VERSION, readAutomationFile } from "../src";

const file = (format: string) => ({
  format,
  version: AUTOMATION_FILE_VERSION,
  name: "Weekly clips",
  trigger: { kind: "manual" },
  nodes: [{ id: "send", kind: "send", input: { url: "https://n8n.example/x" } }],
  edges: [],
});

describe("automation file format", () => {
  test("new files say Takewon", () => {
    expect(AUTOMATION_FILE_FORMAT).toBe("takewon-automation");
    expect(readAutomationFile(file(AUTOMATION_FILE_FORMAT)).ok).toBe(true);
  });

  test("files exported before the rename still import", () => {
    expect(readAutomationFile(file("ncat-dash-automation")).ok).toBe(true);
  });

  test("anything else is not an automation file", () => {
    expect(readAutomationFile(file("something-else")).ok).toBe(false);
  });

  test("an upload trigger keeps asking first, and only a real yes counts", () => {
    const read = (ask: unknown) => {
      const result = readAutomationFile({
        ...file(AUTOMATION_FILE_FORMAT),
        trigger: { kind: "upload", fileType: "video", maxSeconds: 90, ask },
      });
      return result.ok ? result.draft.trigger : null;
    };
    expect(read(true)).toEqual({ kind: "upload", fileType: "video", maxSeconds: 90, ask: true });
    expect(read("yes")).toEqual({ kind: "upload", fileType: "video", maxSeconds: 90 });
  });
});
