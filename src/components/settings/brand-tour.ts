import type { Tour } from "@/components/ui/tour";

/** A short walk around the brand settings, the first time someone opens them. */
export const BRAND_TOUR: Tour = {
  id: "brand",
  steps: [
    {
      id: "tour-brand-welcome",
      title: "Your Brand, Set Once",
      content:
        "Everything here is pulled into every automation by itself: captions, cards, intros and outros all use it. Nobody types it into a step.",
      nextLabel: "Show me",
    },
    {
      id: "tour-brand-look",
      title: "Logo and Colour",
      content: "Your logo goes on videos and pictures, and the colour is used for text on them.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-brand-intro",
      title: "Intro and Outro",
      content: "Short clips that automations can put at the start and end of a video.",
      side: "bottom",
      align: "start",
      optional: true,
    },
    {
      id: "tour-brand-music",
      title: "Music Library",
      content:
        "Tracks that automations can play under a clip. Upload them here or pick from your uploads.",
      side: "top",
      align: "start",
      optional: true,
    },
  ],
};
