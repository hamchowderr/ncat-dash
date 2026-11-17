import { z } from "zod";

/**
 * What Convex sends when someone tags the agent in a review comment (convex/reviewAgent.ts
 * in the dashboard), and how it becomes the agent's prompt.
 */
const text = (max: number) => z.string().max(max);

export const reviewQuestion = z.object({
  question: z.object({
    review: z.object({ title: text(200), status: text(20) }),
    clip: z.object({
      title: text(200),
      version: z.number(),
      versions: z.number(),
      url: text(2000),
      isVideo: z.boolean(),
    }),
    moment: z.object({ seconds: z.number(), label: text(20) }).nullable(),
    thread: z
      .array(z.object({ author: text(200), body: text(4000), isAgent: z.boolean() }))
      .min(1)
      .max(100),
    otherNotes: z
      .array(
        z.object({
          at: text(20).nullable(),
          author: text(200),
          body: text(500),
          resolved: z.boolean(),
        }),
      )
      .max(40),
    automation: z
      .object({ name: text(200), outline: text(20_000), runStatus: text(20) })
      .nullable(),
    askedBy: text(200),
  }),
  still: z.string().url().max(2000).nullable(),
});

export type ReviewQuestion = z.infer<typeof reviewQuestion>["question"];

/** The question as one message for the model. */
export function reviewPrompt(question: ReviewQuestion, hasStill: boolean): string {
  const lines: string[] = [];
  lines.push(`Review: "${question.review.title}" (${question.review.status}).`);
  lines.push(
    `Clip: "${question.clip.title}", version ${question.clip.version} of ${question.clip.versions}.`,
  );
  if (question.moment) {
    lines.push(
      `The comment is pinned to ${question.moment.label}.${hasStill ? " The image is a still of that moment." : " No still of the moment could be taken."}`,
    );
  } else {
    lines.push("The clip is a still image or a file without a timeline.");
  }
  if (question.automation) {
    lines.push("");
    lines.push(
      `The clip was made by the automation "${question.automation.name}" (that run is ${question.automation.runStatus}). How it is built now:`,
    );
    lines.push(question.automation.outline);
  }
  if (question.otherNotes.length > 0) {
    lines.push("");
    lines.push("The team's other notes on this version:");
    for (const note of question.otherNotes) {
      lines.push(
        `- ${note.at ? `${note.at} ` : ""}${note.author}: ${note.body}${note.resolved ? " (resolved)" : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("The thread you were tagged in, oldest first:");
  for (const entry of question.thread) {
    lines.push(`${entry.isAgent ? "You (the agent)" : entry.author}: ${entry.body}`);
  }
  lines.push("");
  lines.push(`Answer ${question.askedBy}'s latest message in this thread.`);
  return lines.join("\n");
}
