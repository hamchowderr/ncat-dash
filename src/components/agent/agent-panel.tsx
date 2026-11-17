"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";

import type { ApprovalViews } from "@/components/chat/approval-view";
import { ChatPanel } from "@/components/chat-panel/chat-panel";
import { Button } from "@/components/ui/button";

import { ToolRow } from "./tool-row";
import { toolWords } from "./tool-words";

/** What each card that asks first says: the change in plain words, never raw settings. */
const APPROVAL_VIEWS: ApprovalViews = Object.fromEntries(
  ["change_automation", "create_automation", "switch_automation"].map((name) => [
    name,
    ({ args }) => {
      const words = toolWords(name, args);
      if (!words) return null;
      return {
        title: words.question,
        body: (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {words.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ),
      };
    },
  ]),
);

export function AgentPanel({
  onAutomation,
  onClose,
}: {
  onAutomation: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <ChatPanel
      title="Agent"
      plan={false}
      className="[--chat-panel-header-height:4rem]"
      greeting={{
        title: "What should run by itself?",
        description:
          "Describe it and the agent builds the automation. It asks before it changes anything.",
      }}
      placeholder="Describe an automation, or a change to this one"
      suggestions={
        onAutomation
          ? [
              {
                label: "Explain this automation",
                prompt: "Explain what this automation does, step by step.",
              },
              {
                label: "Check it for problems",
                prompt: "Check this automation for anything missing or wrong.",
              },
            ]
          : [
              {
                label: "What do I have?",
                prompt: "List my automations and say which are switched on.",
              },
              {
                label: "Clips from each new recording",
                prompt:
                  "Build an automation that makes short clips with captions from each new recording I upload.",
              },
            ]
      }
      approvalViews={APPROVAL_VIEWS}
      renderTool={(call, result) =>
        toolWords(call.name, call.args) ? <ToolRow call={call} result={result} /> : undefined
      }
      onNavigate={(href) => router.push(href)}
      actions={
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
          <X />
          <span className="sr-only">Close the agent</span>
        </Button>
      }
    />
  );
}
