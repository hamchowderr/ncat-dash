import type { Tour } from "@/components/ui/tour";

/** A walk around the review room, the first time someone opens a review. */
export const REVIEW_TOUR: Tour = {
  id: "review-room",
  steps: [
    {
      id: "tour-review-welcome",
      title: "Reviewing a Clip",
      content:
        "Watch it, say what to change at the exact moment, and decide. Your team sees every comment as it is written.",
      nextLabel: "Show me",
    },
    {
      id: "tour-review-clips",
      title: "Every Clip in the Review",
      content: "Move between the clips here. Each one keeps its own comments.",
      side: "right",
      align: "start",
      optional: true,
    },
    {
      id: "tour-review-clip",
      title: "The Clip",
      content:
        "Pause anywhere to comment on that moment. The marks along the bar show where each comment is; click one to jump to it.",
      side: "right",
      align: "start",
    },
    {
      id: "tour-review-comments",
      title: "Comments",
      content:
        "Reply, resolve what is done, and type @ to tag a teammate or the Agent. Each comment remembers the moment it is about.",
      side: "left",
      align: "start",
    },
    {
      id: "tour-review-draw",
      title: "Draw on the Frame",
      content: "Circle or point at exactly what you mean. The drawing goes with your comment.",
      side: "top",
      align: "end",
      optional: true,
    },
    {
      id: "tour-review-version",
      title: "New Versions",
      content:
        "When the changes are made, add the new cut here. Comments stay with the version they were left on, and you can compare two side by side.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-review-share",
      title: "Share With Your Client",
      content:
        "A link your client opens without an account. They can watch, comment and approve, and you see their answer here.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-review-decide",
      title: "Make the Call",
      content:
        "Approve, or ask for changes. When an automation is waiting on this review, approving sends the files on to its next step.",
      side: "bottom",
      align: "end",
      optional: true,
    },
  ],
};
