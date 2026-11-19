import type { Tour } from "@/components/ui/tour";

/** A short walk around starting an automation, the first time someone makes one. */
export const NEW_AUTOMATION_TOUR: Tour = {
  id: "new-automation",
  steps: [
    {
      id: "tour-new-search",
      title: "Start From a Ready-Made One",
      content:
        "Each one already does a whole job, like clips for social or captioning every new upload. Search by what you make.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-new-categories",
      title: "Browse by Kind",
      content: "Or look through them by the kind of content they are for.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-new-empty",
      title: "Or Start Empty",
      content:
        "Build your own from nothing on the canvas. Whichever you pick, you can change every step after.",
      side: "bottom",
      align: "end",
    },
  ],
};
