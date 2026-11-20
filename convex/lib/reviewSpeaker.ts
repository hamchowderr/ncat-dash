import type { ReviewPost } from "./slackPosts";

/**
 * Who a piece of review activity is from, as a chat app shows the sender: the person's
 * name and, for a teammate with one, their picture. Slack and Discord let the dashboard
 * post under that name and picture (still marked as an app); the others show the name in
 * the words. A new review is the dashboard's own news, so it has no speaker.
 */
export type Speaker = { name: string; image: string | null };

/** Only a picture at a public https address can be shown by a chat app. */
function shownImage(image: string | null | undefined): string | null {
  return image && /^https:\/\/\S+$/.test(image) ? image : null;
}

export function speakerOf(
  post: ReviewPost,
  people: { id: string; image: string | null }[],
): Speaker | null {
  switch (post.kind) {
    case "review_opened":
      return null;
    case "client_feedback":
      return { name: `${post.from} (client)`, image: null };
    case "mention":
    case "team_reply": {
      const person = post.fromUserId ? people.find((one) => one.id === post.fromUserId) : undefined;
      return { name: post.from, image: shownImage(person?.image) };
    }
  }
}
