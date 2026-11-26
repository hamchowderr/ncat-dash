import type { Word } from "@takewon/automation-core";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The words said in an upload, from its transcript. Older transcripts kept no word
 *  timings, so their pieces' words are spread evenly over each piece. */
export async function spokenIn(ctx: QueryCtx, itemId: Id<"libraryItems">): Promise<Word[]> {
  const pieces = await ctx.db
    .query("transcriptPieces")
    .withIndex("by_item_and_start", (q) => q.eq("itemId", itemId))
    .take(4000);
  const words: Word[] = [];
  for (const piece of pieces) {
    if (piece.words && piece.words.length > 0) {
      for (const word of piece.words) words.push({ text: word.t, start: word.s, end: word.e });
      continue;
    }
    const said = piece.text.split(/\s+/).filter(Boolean);
    const each = Math.max(0, piece.end - piece.start) / Math.max(1, said.length);
    said.forEach((text, index) =>
      words.push({
        text,
        start: piece.start + index * each,
        end: piece.start + (index + 1) * each,
      }),
    );
  }
  return words;
}
