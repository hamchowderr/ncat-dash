import { describe, expect, test } from "vitest";
import {
  AUTOMATION_FILE_FORMAT,
  AUTOMATION_FILE_VERSION,
  canFailOver,
  getNodeType,
  logicProblem,
  readAutomationFile,
  sendProblem,
  sendSentence,
} from "../src";

describe("Send to a URL", () => {
  test("needs an http or https address", () => {
    expect(sendProblem({})).toBe("Say which address to send to.");
    expect(sendProblem({ url: "not a link" })).toBe(
      "This is not an address. It starts with https://.",
    );
    expect(sendProblem({ url: "ftp://files.example" })).toBe(
      "The address must start with http:// or https://.",
    );
    expect(sendProblem({ url: "http://n8n:5678/webhook/x" })).toBeNull();
    expect(logicProblem({ kind: "send", input: { url: "" } })).toBe(
      "Say which address to send to.",
    );
  });

  test("names where it sends, and can have a way for when it fails", () => {
    expect(sendSentence({ url: " https://n8n.example.com/webhook/clips " })).toBe(
      "To n8n.example.com",
    );
    expect(canFailOver("send")).toBe(true);
    expect(getNodeType("send")).toMatchObject({ title: "Send to a URL", group: "logic" });
  });

  test("travels in an automation file", () => {
    const file = {
      format: AUTOMATION_FILE_FORMAT,
      version: AUTOMATION_FILE_VERSION,
      name: "Hand on",
      trigger: { kind: "manual" },
      nodes: [{ id: "send", kind: "send", input: { url: "https://n8n.example/x" } }],
      edges: [],
    };
    const read = readAutomationFile(file);
    expect(read.ok && read.draft.nodes[0].kind).toBe("send");
  });
});
