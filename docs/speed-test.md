# Speed Test

How long does a video take? `pnpm speed-test` answers that with real numbers. It runs the
same videos through the main ready-mades on a Kontifi copy, times every run and every step
from what the dashboard records, and keeps each time in a history file. Run it after a
change to the toolkit, the server or the steps, and a run that got slower shows at once.

It drives the dashboard exactly as a person would (Run now with a file address), so the
times include everything a team waits for: the dashboard handing jobs out, the toolkit
working, and its results coming back.

## The Videos

Cut from NASA's public-domain interview with astronaut Jeanette Epps (October 2019): one
person talking to camera, with questions off camera, at 30 fps.

| Video                      | Length | Shape     | Ready-mades it goes through                                                                    |
| -------------------------- | ------ | --------- | ---------------------------------------------------------------------------------------------- |
| 40 s vertical talking head | 40 s   | 1080x1920 | Caption every new upload, Clean Up Pauses And Retakes, Clips for social                        |
| 81 s wide talking head     | 81 s   | 1920x1080 | the three above, plus Vertical with a blurred background and Vertical that follows the speaker |
| 8 min wide interview       | 8 min  | 1920x1080 | Clips for social, Clips that follow the speaker, Clean Up Pauses And Retakes                   |

None of them pays an AI model for each video, so a test costs only toolkit time. The list
is in `packages/speed-test/src/plan.ts`.

## Running It

Make an account and a team on the copy you want to test, connect its toolkit, then:

```bash
export KONTIFI_URL=https://your-dashboard.example          # the dashboard's own address
export KONTIFI_CONVEX_URL=https://your-convex.example      # Convex's API (port 3210)
export KONTIFI_CONVEX_SITE_URL=https://your-site.example   # Convex's HTTP actions (port 3211)
export KONTIFI_EMAIL=speed-test@example.com
export KONTIFI_PASSWORD=...
export KONTIFI_TEAM="Speed Tests"                          # needed when the account has several teams
# Optional: the toolkit itself, so the test waits for it to be quiet and notes how busy it was.
export KONTIFI_TOOLKIT_URL=https://your-toolkit.example
export KONTIFI_TOOLKIT_API_KEY=...

pnpm speed-test                                   # everything, about an hour
pnpm speed-test --videos talking-head-40s-vertical # one video
pnpm speed-test --only caption-uploads,social-clips
pnpm speed-test --note "after moving to 8 cores"  # kept with each result
pnpm speed-test --dry-run                         # what would run
pnpm speed-test --report-only                     # the history table, nothing runs
```

The test keeps one automation per ready-made on the team, named "Speed Test: …", and makes
it the first time.

## What It Keeps

In `speed-test-results/` (or `--results <folder>`):

- `history.jsonl`: every run ever, one per line, saved as soon as each run ends.
- `latest.md` and a dated copy: this test's table, each run's steps, and how each compares
  with earlier runs of the same ready-made on the same video.
- `history.md`: each ready-made and video across the last ten tests.

A run is called slower or faster only when it is at least a quarter and at least 15
seconds away from the middle of its last five times, so ordinary wobble doesn't count.

## Fair Numbers

- One run at a time, never two: on a shared server two runs slow each other down.
- Before each run it waits up to 10 minutes for the toolkit to be quiet (no jobs, CPU
  under 50%). If it never is, the run goes ahead and its result says so.
- A run at an approval counts up to the approval: that wait is a person's, not the machine's.
- A run that takes longer than a quarter of an hour plus eight times its video's length is
  stopped and recorded as too slow.
