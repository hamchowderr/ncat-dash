import type { Tour } from "@/components/ui/tour";

/** A walk around the automation editor, the first time someone opens an automation. */
export const EDITOR_TOUR: Tour = {
  id: "automation-editor",
  steps: [
    {
      id: "tour-editor-welcome",
      title: "Your Automation",
      content:
        "An automation runs by itself: something starts it, then each step does its part and hands the files on to the next. Here is how to shape one.",
      nextLabel: "Show me",
    },
    {
      id: "tour-editor-canvas",
      title: "The Canvas",
      content:
        "The trigger sits first and the steps follow it. Click any of them to open its settings at the side, where you can test it on one file and choose what happens if it fails.",
      side: "top",
    },
    {
      id: "tour-editor-add",
      title: "Add a Step",
      content:
        "Opens the list of steps to choose from. You can also press + on a line between two steps to put one in the middle.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-editor-note",
      title: "Notes",
      content: "Leave a note on the canvas for your team, or for yourself later.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-editor-view",
      title: "Find Your Way Around",
      content: "Zoom in and out, fit everything on screen, or tidy the steps into neat rows.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-editor-client",
      title: "Who It Is For",
      content: "Make it work for a client: its runs use their brand and deliver to their folder.",
      side: "bottom",
      align: "start",
      optional: true,
    },
    {
      id: "tour-editor-switch",
      title: "On or Off",
      content:
        "Switched on, it runs by itself every time its trigger fires. While it is on, your changes wait as a draft until you publish them.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-editor-run",
      title: "Run It Now",
      content: "Try the whole automation once, on a file you pick, and watch each step as it runs.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-editor-tabs",
      title: "Runs and Versions",
      content:
        "Runs lists every time it ran, step by step. Versions keeps each one you published, so you can go back to an earlier one.",
      side: "bottom",
      align: "start",
    },
  ],
};
