import { describe, expect, test } from "vitest";
import {
  decisionOf,
  discordAlert,
  discordKept,
  discordSettled,
  slackAlert,
  slackSettled,
  slackText,
} from "./lib/chatAlerts/chatFormats";

// How an alert reads in Slack and in Discord: the title, its lines, a link to the
// dashboard, and Approve / Send back buttons that carry the approval step they decide.

const approval = {
  title: "Approval waiting: Weekly shorts",
  lines: ["Step: Check the clips", "Note: <b>look</b> at *this*"],
  link: "https://dash.test/runs/r1",
  linkLabel: "Open the run",
  runStepId: "step1" as never,
  actions: [
    { id: "approve" as const, label: "Approve" },
    { id: "send_back" as const, label: "Send back" },
  ],
};

describe("alerts in Slack", () => {
  test("show the words, a link, and buttons that name the alert", () => {
    const message = slackAlert(approval);
    expect(message.text).toBe("Approval waiting: Weekly shorts");
    const [section, actions] = message.blocks as [
      { text: { text: string } },
      { elements: { action_id: string; value: string; style?: string; text: { text: string } }[] },
    ];
    expect(section.text.text).toContain("*Approval waiting: Weekly shorts*");
    // Slack markup in the alert's own words is escaped, not obeyed.
    expect(section.text.text).toContain("&lt;b&gt;look&lt;/b&gt;");
    expect(section.text.text).toContain("<https://dash.test/runs/r1|Open the run>");
    expect(actions.elements.map((one) => [one.action_id, one.value, one.text.text])).toEqual([
      ["ncat_alert_approve", "step1", "Approve"],
      ["ncat_alert_send_back", "step1", "Send back"],
    ]);
    expect(actions.elements[0].style).toBe("primary");
  });

  test("a failed run has no buttons", () => {
    const message = slackAlert({ ...approval, title: "A run failed", actions: undefined });
    expect(message.blocks).toHaveLength(1);
  });

  test("once decided, the buttons give way to what happened", () => {
    const message = slackSettled(slackText(approval), "Approved by Ada");
    expect(JSON.stringify(message.blocks)).not.toContain("ncat_alert_");
    expect(JSON.stringify(message.blocks)).toContain("Approved by Ada");
    expect(JSON.stringify(message.blocks)).toContain("Open the run");
  });
});

describe("alerts in Discord", () => {
  test("show the words and a row with the buttons and a dashboard link", () => {
    const message = discordAlert(approval);
    expect(message.content.split("\n")[0]).toBe("**Approval waiting: Weekly shorts**");
    // Discord markdown in the alert's own words is escaped.
    expect(message.content).toContain("\\*this\\*");
    const row = message.components[0] as {
      components: { custom_id?: string; url?: string; label: string; style: number }[];
    };
    expect(row.components.map((one) => one.custom_id ?? one.url)).toEqual([
      "ncat_alert_approve\nstep1",
      "ncat_alert_send_back\nstep1",
      "https://dash.test/runs/r1",
    ]);
    expect(row.components[0].style).toBe(3);
  });

  test("never goes over Discord's 2000 characters", () => {
    const long = discordAlert({ ...approval, lines: ["x".repeat(3000)] });
    expect(long.content.length).toBeLessThanOrEqual(2000);
  });

  test("once decided, only the link stays and the outcome is added", () => {
    const message = discordSettled(discordKept(approval), "Sent back by Ada");
    expect(JSON.stringify(message.components)).toContain("https://dash.test/runs/r1");
    expect(JSON.stringify(message.components)).not.toContain("ncat_alert_");
    expect(message.content).toContain("Sent back by Ada");
  });
});

test("only our own buttons count as a decision", () => {
  expect(decisionOf("ncat_alert_approve")).toBe("approve");
  expect(decisionOf("ncat_alert_send_back")).toBe("send_back");
  expect(decisionOf("tool_approve:1")).toBeNull();
});
