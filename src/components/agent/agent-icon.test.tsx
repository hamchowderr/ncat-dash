import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import { describe, expect, test } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { CATEGORY_ICONS, nodeLook } from "@/components/automations/flow-nodes";
import { AGENT_PERSON, Face } from "@/components/review/person";

import { AgentRail, AgentTrigger } from "./agent-rail";

// The agent's mark is a robot everywhere it shows, never the sparkle star.
describe("the agent's robot icon", () => {
  test("the folded agent strip's open button is the robot, with no star", () => {
    const { container } = render(
      <TooltipProvider>
        <AgentRail />
      </TooltipProvider>,
    );
    expect(container.querySelector("svg[class*='sparkles']")).toBeNull();
    // One icon only: the open button is the robot, with no extra mark down the strip.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const open = screen.getByRole("button", { name: "Open the agent" });
    expect(open.querySelector("svg.lucide-bot")).not.toBeNull();
    expect(container.querySelector("[data-agent-rail] svg")).toBeNull();
  });

  test("the phone's open button in the top bar is the robot too", () => {
    render(<AgentTrigger />);
    const open = screen.getByRole("button", { name: "Open the agent" });
    expect(open.querySelector("svg.lucide-bot")).not.toBeNull();
    expect(open.querySelector("svg[class*='panel-right']")).toBeNull();
  });

  test("the agent's face in the review room is the robot", () => {
    const { container } = render(<Face {...AGENT_PERSON} />);
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  test("the Plan B-Roll step and the team's steps use the robot", () => {
    expect(nodeLook({ kind: "broll-plan", input: {} }).icon).toBe(Bot);
    expect(CATEGORY_ICONS.team).toBe(Bot);
  });

  test("no screen uses the sparkle star icon any more", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.tsx")) files.push(path);
      }
    };
    walk(join(process.cwd(), "src"));
    const withStar = files.filter((file) =>
      /\b(Wand)?Sparkles(Icon)?\b/.test(readFileSync(file, "utf8")),
    );
    expect(withStar).toEqual([]);
  });
});
