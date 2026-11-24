import type { TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Every table that holds a team's data, and how to find the team's rows in it: an index
 * whose first field is `organizationId`. Deleting a team (teamDeletion.ts) goes down this
 * list a batch at a time until each is empty.
 *
 * A new table with an `organizationId` belongs here, or in KEPT_AFTER_DELETION with its
 * reason: teamPurge.test.ts reads the schema and fails when a table is in neither.
 */
export interface PurgeTable {
  table: TableNames;
  index: string;
  /** Rows taken per batch. Lower for tables whose rows are big (words, frames, lines). */
  batch?: number;
  /** Rows elsewhere that point at a row here and have no team of their own. */
  dependents?: (ctx: MutationCtx, id: string) => Promise<"done" | "more">;
}

const DEPENDENTS_AT_ONCE = 200;

/** Deletes up to a batch of rows in `table` found by `index` = `value`. */
async function deleteBy(
  ctx: MutationCtx,
  table: TableNames,
  index: string,
  field: string,
  value: string,
): Promise<"done" | "more"> {
  const rows = await (ctx.db.query(table) as unknown as Indexed)
    .withIndex(index, (q) => q.eq(field, value))
    .take(DEPENDENTS_AT_ONCE);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length < DEPENDENTS_AT_ONCE ? "done" : "more";
}

/** The one shape of indexed read the purge needs, without each table's own types. */
interface Indexed {
  withIndex(
    index: string,
    range: (q: { eq(field: string, value: unknown): unknown }) => unknown,
  ): { take(n: number): Promise<{ _id: never }[]> };
}

/** Replies written in a chat app to a review comment: they name the comment, not the team. */
async function commentReplies(ctx: MutationCtx, id: string): Promise<"done" | "more"> {
  let state: "done" | "more" = "done";
  for (const table of [
    "slackReplies",
    "discordReplies",
    "teamsReplies",
    "telegramReviewReplies",
  ] as const) {
    if ((await deleteBy(ctx, table, "by_comment", "commentId", id)) === "more") state = "more";
  }
  return state;
}

/**
 * Automations go first, so nothing new starts while the rest is taken away; the
 * connection to the toolkit goes last, since the files are deleted through it before the
 * rows are (teamDeletion.ts).
 */
export const PURGE_TABLES: PurgeTable[] = [
  {
    table: "automations",
    index: "by_organization",
    batch: 50,
    dependents: async (ctx, id) => {
      // Files a watched-folder automation has seen, and the calls its webhook took.
      const seen = await deleteBy(ctx, "watchedFiles", "by_automation_and_key", "automationId", id);
      const calls = await deleteBy(ctx, "hookCalls", "by_automation_and_key", "automationId", id);
      return seen === "more" || calls === "more" ? "more" : "done";
    },
  },
  { table: "automationVersions", index: "by_organization", batch: 50 },
  { table: "automationNotes", index: "by_organization" },
  { table: "automationFolders", index: "by_organization" },
  { table: "workflows", index: "by_organization" },
  { table: "teamSteps", index: "by_organization", batch: 50 },
  { table: "runs", index: "by_organization" },
  { table: "runSteps", index: "by_organization_and_status" },
  { table: "jobs", index: "by_organization" },
  { table: "toolkitTurns", index: "by_organization" },
  { table: "pickBatches", index: "by_organization" },
  { table: "pickAnswers", index: "by_question" },
  { table: "pickedMoments", index: "by_source" },
  { table: "spokenWords", index: "by_source", batch: 10 },
  { table: "speakerMasks", index: "by_source", batch: 10 },
  { table: "alerts", index: "by_organization" },
  { table: "chatAlertMessages", index: "by_organization" },
  { table: "uploads", index: "by_organization" },
  { table: "bucketFiles", index: "by_organization_and_key" },
  { table: "libraryItems", index: "by_organization" },
  { table: "libraryFrames", index: "by_organization", batch: 20 },
  { table: "transcriptPieces", index: "by_organization", batch: 20 },
  { table: "translations", index: "by_organization", batch: 20 },
  { table: "captionTranslations", index: "by_source_and_language", batch: 10 },
  { table: "libraryCounters", index: "by_organization_and_letter" },
  { table: "librarySettings", index: "by_organization" },
  { table: "lookStudies", index: "by_organization" },
  { table: "teamLooks", index: "by_organization" },
  { table: "stockKeys", index: "by_organization" },
  { table: "reviews", index: "by_organization" },
  { table: "reviewClips", index: "by_organization" },
  { table: "reviewComments", index: "by_organization", dependents: commentReplies },
  { table: "reviewShares", index: "by_organization" },
  { table: "reviewChatPosts", index: "by_organization" },
  { table: "clientPortals", index: "by_organization" },
  { table: "clients", index: "by_organization" },
  { table: "projects", index: "by_organization" },
  { table: "deliverables", index: "by_organization_and_dueAt" },
  { table: "storyboards", index: "by_organization" },
  { table: "storyboardChapters", index: "by_organization" },
  { table: "storyboardTakes", index: "by_organization" },
  { table: "calendarPosts", index: "by_organization_and_at" },
  { table: "calendarSlots", index: "by_organization" },
  { table: "creators", index: "by_organization" },
  { table: "creatorRights", index: "by_organization" },
  { table: "slackConnections", index: "by_organization" },
  { table: "slackThreads", index: "by_organization" },
  { table: "slackPeople", index: "by_organization" },
  { table: "discordServers", index: "by_organization" },
  { table: "discordReviewThreads", index: "by_organization" },
  { table: "discordPeople", index: "by_member" },
  { table: "discordLinkStarts", index: "by_organization" },
  { table: "teamsTenants", index: "by_organization" },
  { table: "teamsTeams", index: "by_organization" },
  { table: "teamsPeople", index: "by_member" },
  { table: "teamsLinkStarts", index: "by_organization" },
  { table: "teamsReviewThreads", index: "by_organization" },
  { table: "telegramPeople", index: "by_member" },
  { table: "telegramGroups", index: "by_organization" },
  { table: "telegramReviewPosts", index: "by_organization" },
  { table: "telegramLinkStarts", index: "by_organization" },
  { table: "zoomConnections", index: "by_organization" },
  { table: "zoomLinkStarts", index: "by_organization" },
  { table: "zoomImports", index: "by_organization" },
  { table: "googleMeetConnections", index: "by_organization" },
  { table: "googleMeetLinkStarts", index: "by_organization" },
  { table: "googleMeetImports", index: "by_organization" },
  { table: "microsoftConnections", index: "by_organization" },
  { table: "microsoftLinkStarts", index: "by_organization" },
  { table: "microsoftChannels", index: "by_organization" },
  { table: "microsoftImports", index: "by_organization" },
  { table: "dropboxConnections", index: "by_organization" },
  { table: "dropboxLinkStarts", index: "by_organization" },
  { table: "dropboxFolders", index: "by_organization" },
  { table: "dropboxImports", index: "by_organization" },
  { table: "dropboxSends", index: "by_organization" },
  { table: "linkImports", index: "by_organization" },
  { table: "emailConnections", index: "by_organization" },
  { table: "notificationPreferences", index: "by_organization_and_user" },
  { table: "teamSettings", index: "by_organization" },
  { table: "toolkitConnections", index: "by_organization" },
];

/**
 * Tables with an `organizationId` whose rows stay after the team is deleted, and why.
 */
export const KEPT_AFTER_DELETION: Partial<Record<TableNames, string>> = {
  // Holds only keyed hashes of the owner's mailbox and network. Deleting it would let
  // someone delete a team and make a new one for a fresh free trial (lib/trial.ts).
  teamTrials: "trial abuse protection",
  // The record that this team's data was deleted.
  teamDeletions: "the record of the deletion itself",
};

/**
 * Deletes up to one batch of the team's rows from one table. "more" when the table may
 * still hold some, "done" when it is empty.
 */
export async function purgeBatch(
  ctx: MutationCtx,
  entry: PurgeTable,
  organizationId: string,
): Promise<{ deleted: number; state: "done" | "more" }> {
  const size = entry.batch ?? 100;
  const rows = await (ctx.db.query(entry.table) as unknown as Indexed)
    .withIndex(entry.index, (q) => q.eq("organizationId", organizationId))
    .take(size);
  let deleted = 0;
  let waiting = false;
  for (const row of rows) {
    if (entry.dependents && (await entry.dependents(ctx, row._id)) === "more") {
      // Its dependents take more than one batch: the row goes on a later one.
      waiting = true;
      continue;
    }
    await ctx.db.delete(row._id);
    deleted++;
  }
  return { deleted, state: rows.length < size && !waiting ? "done" : "more" };
}
