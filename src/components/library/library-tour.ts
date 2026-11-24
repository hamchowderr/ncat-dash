import type { Tour } from "@/components/ui/tour";

/** A walk around the library, the first time someone opens it. */
export const LIBRARY_TOUR: Tour = {
  id: "library",
  steps: [
    {
      id: "tour-library-welcome",
      title: "Your Library",
      content:
        "Every file your team has, uploads and what your automations made. Each has a short ID, like C12, that you can use with the agent.",
      nextLabel: "Show me",
    },
    {
      id: "tour-library-search",
      title: "Search What Was Said",
      content:
        "Find a file by a line someone said in it, its name, a tag or its ID, and jump straight to the moment.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-library-searchable",
      title: "Searchable By Itself",
      content:
        "Every video and sound, uploaded or made by your automations, is transcribed once, with no AI tokens spent, so you can search what was said in them.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-library-filters",
      title: "Narrow It Down",
      content: "Show only one kind of file, one client's, one tag or your starred ones.",
      side: "bottom",
      align: "start",
      optional: true,
    },
    {
      id: "tour-library-items",
      title: "Open a File",
      content:
        "See what was said in it, add tags and stars, and find everything that was made from it.",
      side: "top",
      align: "start",
      optional: true,
    },
  ],
};
