import { formatMoment } from "@ncat-dash/review-core";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { type Speaker, speakerOf } from "./lib/reviewSpeaker";
import { type ReviewPost, reviewPostValidator } from "./lib/slackPosts";
import { botToken, plain, site } from "./microsoftTeams";

// Review activity in the team's Microsoft Teams channel, and replies written there coming
// back, the same way as Slack (slackReview.ts). New reviews, client feedback and mentions
// are posted to the channel the team picked in Settings; each comment thread becomes a
// Teams reply thread, and a teammate's reply in that thread becomes their reply in the
// review room.

export const postContext = internalQuery({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, { organizationId, post }) => {
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .unique();
    const review = await ctx.db.get(post.reviewId);
    if (!tenant?.alertConversationId || !tenant.alertServiceUrl || !review) return null;
    const commentId = "commentId" in post ? post.commentId : undefined;
    const comment = commentId ? await ctx.db.get(commentId) : null;
    const clip = comment ? await ctx.db.get(comment.clipId) : null;
    const thread = commentId
      ? await ctx.db
          .query("teamsReviewThreads")
          .withIndex("by_comment", (q) => q.eq("commentId", commentId))
          .first()
      : null;
    const clips = await ctx.db
      .query("reviewClips")
      .withIndex("by_review", (q) => q.eq("reviewId", review._id))
      .take(51);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId,
    });
    const nameOfMember = (userId: string | null) =>
      team.members.find((member) => member.userId === userId)?.name ?? null;
    // People named in a mention, tagged in Teams when their Microsoft account is known.
    const mentioned = [];
    if (post.kind === "mention") {
      for (const userId of post.mentioned) {
        const name = nameOfMember(userId);
        if (!name) continue;
        const link = await ctx.db
          .query("teamsPeople")
          .withIndex("by_member", (q) =>
            q.eq("organizationId", organizationId).eq("userId", userId),
          )
          .unique();
        mentioned.push({ name, aadObjectId: link?.aadObjectId ?? null });
      }
    }
    const people = await ctx.runQuery(components.betterAuth.members.people, { organizationId });
    return {
      speaker: speakerOf(post, people),
      // A reply goes into its thread, wherever that thread is; a new one to the channel.
      conversationId: thread?.conversationId ?? tenant.alertConversationId,
      serviceUrl: thread?.serviceUrl ?? tenant.alertServiceUrl,
      rootActivityId: thread?.rootActivityId ?? null,
      reviewTitle: review.title,
      fromAutomation: Boolean(review.runId),
      openedBy: nameOfMember(review.createdBy),
      clipCount: clips.length,
      clipId: comment?.clipId ?? null,
      clipTitle: clip?.title ?? null,
      time: comment?.time ?? null,
      mentioned,
    };
  },
});

function quoted(body: string): string {
  return body
    .trim()
    .split("\n")
    .map((line) => `> ${plain(line)}`)
    .join("\n");
}

type PostContext = {
  reviewTitle: string;
  fromAutomation: boolean;
  openedBy: string | null;
  clipCount: number;
  clipId: string | null;
  clipTitle: string | null;
  time: number | null;
  rootActivityId: string | null;
};

function linkAndWhere(post: ReviewPost, context: PostContext, siteUrl: string) {
  const query = new URLSearchParams();
  if (context.clipId) query.set("clip", context.clipId);
  if ("commentId" in post && post.commentId) query.set("comment", post.commentId);
  const tail = query.toString();
  const link = `[${plain(context.reviewTitle)}](${siteUrl}/review/${post.reviewId}${
    tail ? `?${tail}` : ""
  })`;
  const where =
    context.time === null
      ? link
      : `${link}, ${plain(context.clipTitle ?? "a clip")} at ${formatMoment(context.time)}`;
  return { link, where };
}

/** The words of a post, in Teams markdown. Exported for the tests. */
export function postText(
  post: ReviewPost,
  context: PostContext,
  tags: string[],
  siteUrl: string,
): string {
  const { link, where } = linkAndWhere(post, context, siteUrl);
  const inThread = context.rootActivityId !== null;
  const tagged = tags.length > 0 ? `${tags.join(" ")} ` : "";

  switch (post.kind) {
    case "review_opened": {
      const clips = context.clipCount === 1 ? "1 clip" : `${context.clipCount} clips`;
      if (context.fromAutomation) {
        return `New review: ${link} (${clips}). The automation is waiting for someone to approve it.`;
      }
      return `New review: ${link} (${clips})${
        context.openedBy ? `, opened by ${plain(context.openedBy)}` : ""
      }.`;
    }
    case "client_feedback":
      if (inThread) return `**${plain(post.from)}** (client): ${plain(post.body)}`;
      return post.commentId
        ? `**${plain(post.from)}** (client) commented on ${where}:\n\n${quoted(post.body)}`
        : `**${plain(post.from)}** (client) on ${link}: ${plain(post.body)}`;
    case "mention":
      if (inThread) return `${tagged}**${plain(post.from)}**: ${plain(post.body)}`;
      return `**${plain(post.from)}** mentioned ${
        tags.length > 0 ? tags.join(" ") : "someone"
      } on ${where}:\n\n${quoted(post.body)}`;
    case "team_reply":
      return `**${plain(post.from)}**: ${plain(post.body)}`;
  }
}

/**
 * Something a person wrote, as Teams shows it closest to coming from them: an Adaptive
 * Card headed by their name and picture (clients as "Riley (client)"), then what they
 * wrote. Teams has no way for a bot to post under someone else's name, so the card's
 * header is how the writer is shown. Exported for the tests.
 */
export function speakerCard(
  post: Exclude<ReviewPost, { kind: "review_opened" }>,
  context: PostContext,
  tags: string[],
  siteUrl: string,
  speaker: Speaker,
  entities: unknown[],
) {
  const { link, where } = linkAndWhere(post, context, siteUrl);
  const inThread = context.rootActivityId !== null;
  const tagged = tags.length > 0 ? `${tags.join(" ")} ` : "";
  const body = plain(post.body);
  let lead: string;
  let quote: string | null = null;
  switch (post.kind) {
    case "client_feedback":
      if (inThread) lead = body;
      else {
        lead = post.commentId ? `Commented on ${where}` : `On ${link}`;
        quote = body;
      }
      break;
    case "mention":
      if (inThread) lead = `${tagged}${body}`;
      else {
        lead = `Mentioned ${tags.length > 0 ? tags.join(" ") : "someone"} on ${where}`;
        quote = body;
      }
      break;
    case "team_reply":
      lead = body;
      break;
  }
  const header = {
    type: "ColumnSet",
    columns: [
      ...(speaker.image
        ? [
            {
              type: "Column",
              width: "auto",
              items: [
                {
                  type: "Image",
                  url: speaker.image,
                  altText: speaker.name,
                  style: "Person",
                  size: "Small",
                },
              ],
            },
          ]
        : []),
      {
        type: "Column",
        width: "stretch",
        verticalContentAlignment: "Center",
        items: [{ type: "TextBlock", text: plain(speaker.name), weight: "Bolder", wrap: true }],
      },
    ],
  };
  return {
    contentType: "application/vnd.microsoft.card.adaptive",
    content: {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        header,
        { type: "TextBlock", text: lead, wrap: true },
        ...(quote
          ? [
              {
                type: "Container",
                style: "emphasis",
                items: [{ type: "TextBlock", text: quote, wrap: true }],
              },
            ]
          : []),
      ],
      msteams: { width: "Full", ...(entities.length > 0 ? { entities } : {}) },
    },
  };
}

/** Posts one piece of review activity to the team's Teams channel. */
export const post = internalAction({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.microsoftTeamsReview.postContext, args);
    if (!context) return;
    const token = await botToken();
    if (!token) return;
    // Someone whose Microsoft account is known is tagged, so Teams tells them.
    const tags: string[] = [];
    const entities = [];
    for (const person of context.mentioned) {
      if (person.aadObjectId) {
        const tag = `<at>${plain(person.name)}</at>`;
        tags.push(tag);
        entities.push({
          type: "mention",
          text: tag,
          mentioned: { id: person.aadObjectId, name: person.name },
        });
      } else {
        tags.push(`@${plain(person.name)}`);
      }
    }
    const conversation = context.rootActivityId
      ? `${context.conversationId};messageid=${context.rootActivityId}`
      : context.conversationId;
    const response = await fetch(
      `${context.serviceUrl.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(
        conversation,
      )}/activities`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(
          context.speaker && args.post.kind !== "review_opened"
            ? {
                // Shown under the writer's name and picture; a new review stays the bot's.
                type: "message",
                summary: `${context.speaker.name}: ${args.post.body}`.slice(0, 200),
                attachments: [
                  speakerCard(args.post, context, tags, site(), context.speaker, entities),
                ],
              }
            : {
                type: "message",
                textFormat: "markdown",
                text: postText(args.post, context, tags, site()),
                ...(entities.length > 0 ? { entities } : {}),
              },
        ),
      },
    ).catch(() => null);
    if (!response?.ok) return;
    const sent = (await response.json().catch(() => ({}))) as { id?: string };
    const commentId = "commentId" in args.post ? args.post.commentId : undefined;
    if (sent.id && commentId && !context.rootActivityId) {
      await ctx.runMutation(internal.microsoftTeamsReview.rememberThread, {
        organizationId: args.organizationId,
        conversationId: context.conversationId,
        rootActivityId: sent.id,
        serviceUrl: context.serviceUrl,
        reviewId: args.post.reviewId,
        commentId,
      });
    }
  },
});

export const rememberThread = internalMutation({
  args: {
    organizationId: v.string(),
    conversationId: v.string(),
    rootActivityId: v.string(),
    serviceUrl: v.string(),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("teamsReviewThreads")
      .withIndex("by_comment", (q) => q.eq("commentId", args.commentId))
      .first();
    if (!existing) await ctx.db.insert("teamsReviewThreads", args);
  },
});

/** Teams' message markup taken down to the words a person wrote. Exported for the tests. */
export function plainFromTeams(text: string): string {
  return text
    .replace(/<at>([^<]*)<\/at>/gi, "@$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export type ReviewReply =
  { handled: false } | { handled: true; added: boolean; message: string | null };

/**
 * A message written in a Teams thread. When the thread is a review thread, the message
 * becomes the writer's reply in the review room, and the agent does not answer it.
 * A message mentioning the bot (its name) has that name taken out first.
 */
export const reply = internalAction({
  args: {
    tenantId: v.string(),
    aadObjectId: v.string(),
    conversationId: v.string(),
    rootActivityId: v.string(),
    activityId: v.string(),
    text: v.string(),
    botName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ReviewReply> => {
    const thread = await ctx.runQuery(internal.microsoftTeamsReview.threadFor, {
      conversationId: args.conversationId,
      rootActivityId: args.rootActivityId,
    });
    if (!thread) return { handled: false };
    const tenant = await ctx.runQuery(internal.microsoftTeams.tenantById, {
      tenantId: args.tenantId,
    });
    if (!tenant || tenant.organizationId !== thread.organizationId) return { handled: false };
    const person = await ctx.runMutation(internal.microsoftTeams.linkFor, {
      aadObjectId: args.aadObjectId,
      organizationId: thread.organizationId,
    });
    if (!person) {
      return {
        handled: true,
        added: false,
        message:
          'Your reply stays in Teams: link your Microsoft account in the dashboard (Settings, Microsoft Teams, "Link my Microsoft account") and your replies here go into the review.',
      };
    }
    let body = plainFromTeams(args.text);
    if (args.botName) {
      body = body.split(`@${args.botName}`).join("").trim();
    }
    if (!body) return { handled: true, added: false, message: null };
    const added = await ctx.runMutation(internal.reviews.commentFromTeams, {
      commentId: thread.commentId,
      userId: person.userId,
      body,
      conversationId: args.conversationId,
      activityId: args.activityId,
    });
    return { handled: true, added: added !== null, message: null };
  },
});

export const threadFor = internalQuery({
  args: { conversationId: v.string(), rootActivityId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("teamsReviewThreads")
      .withIndex("by_teams_thread", (q) =>
        q.eq("conversationId", args.conversationId).eq("rootActivityId", args.rootActivityId),
      )
      .first(),
});
