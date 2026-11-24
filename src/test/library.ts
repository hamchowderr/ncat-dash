import { api } from "@convex/_generated/api";

import { answerQuery } from "@/test/convex";

/** A team's Library with nothing in it yet: where files are brought in. */
export const EMPTY_LIBRARY = {
  items: [],
  searchNewFiles: false,
  filled: true,
  canChangeSettings: true,
  tags: [],
  clients: [],
};

export function emptyLibrary() {
  answerQuery(api.library.list, EMPTY_LIBRARY);
}
