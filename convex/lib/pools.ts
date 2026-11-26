// Background work goes through Convex's Workpool component, which caps how much runs at
// once, tries failed actions again with backoff and jitter, and always calls onComplete,
// even when an action crashes or times out. Registered in convex.config.ts.
import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

/** Tries for a post to a caller's address: the first, then three more. */
export const OUTBOUND_TRIES = 4;

/**
 * Posts to addresses people gave us: Send to a URL steps and run-end callbacks. A post
 * that is not answered with a 2xx is tried again after about 30 seconds, 2 minutes and
 * 8 minutes.
 */
export const outboundPool = new Workpool(components.outboundPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: OUTBOUND_TRIES, initialBackoffMs: 30_000, base: 4 },
});

/**
 * Calls to a team's toolkit: sending a job and asking about a late one. The toolkit's own
 * queue, and each team's limit on jobs at once (lib/queue.ts), decide how much it runs;
 * this only keeps the calls from piling up. Not tried again here: a job the toolkit could
 * not take is failed, and its step's own retries (Settings) send it again.
 */
export const toolkitPool = new Workpool(components.toolkitPool, {
  maxParallelism: 20,
  retryActionsByDefault: false,
});

/**
 * Catch-up work started for many items at once: reading files that came in from outside,
 * transcribing old uploads, drafting storyboards, checking connected Google Meet accounts,
 * translating captions. A few at a time, so a big batch never crowds out live work.
 */
export const backgroundPool = new Workpool(components.backgroundPool, {
  maxParallelism: 4,
  retryActionsByDefault: false,
});

/**
 * Review activity posted to a team's chat apps (Slack, Discord, Teams, Telegram). Each
 * team's posts to one app go one at a time, in order (lib/reviewChatQueue.ts); this caps
 * how many teams' posts are sent at once. Not tried again: a post that might have reached
 * the chat would show twice.
 */
export const chatPool = new Workpool(components.chatPool, {
  maxParallelism: 10,
  retryActionsByDefault: false,
});

/**
 * Page recordings for storyboard takes (pageRecordings.ts): one at a time. The agent
 * server makes one recording at a time (Mastra's browser recording is one per process),
 * and each holds a Firecrawl browser open while it runs. Not tried again: a take that
 * failed says why, and the person records it again.
 */
export const recordingPool = new Workpool(components.recordingPool, {
  maxParallelism: 1,
  retryActionsByDefault: false,
});
