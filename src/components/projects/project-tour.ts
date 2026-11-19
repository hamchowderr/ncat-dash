import type { Tour } from "@/components/ui/tour";

/** A walk around a project, the first time someone opens one. */
export const PROJECT_TOUR: Tour = {
  id: "project",
  steps: [
    {
      id: "tour-project-welcome",
      title: "Your Project",
      content:
        "One piece of work and everything it has to deliver, like an episode's full cut, its shorts and the thumbnail. Each of those is a slot.",
      nextLabel: "Show me",
    },
    {
      id: "tour-project-client",
      title: "Who It Is For",
      content: "Pick the client it is for, or keep it for your own team.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-project-slots",
      title: "Slots",
      content:
        "Each slot moves from to do, through review and approval, to published. Click one to put a file in or to run an automation on it. Give it a due date on the calendar.",
      side: "top",
      align: "start",
    },
    {
      id: "tour-project-layout",
      title: "List or Board",
      content: "The board shows a column for each stage, and you drag slots between them.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-project-add",
      title: "Add a Slot",
      content: "Pick the kind, such as a short or a thumbnail, and add it to the project.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-project-review",
      title: "The Review Room",
      content:
        "Every clip of the project in one place, for your team and your client to comment on.",
      side: "bottom",
      align: "end",
      optional: true,
    },
  ],
};
