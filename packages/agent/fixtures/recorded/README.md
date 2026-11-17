# Recorded answers

Answers a real model gave, saved by `pnpm dev:record` so they can be played back for free
with `pnpm dev:replay`. See "Recording a real model" in the repository README.

Each file is written by AIMock. Read a recording before committing it: it holds the
message the person typed and the model's reply, including the settings of any change it made.
A call that failed (a wrong key, say) is saved too; delete that file and record again.

The recorder loads this folder when it starts and answers from it before it asks the real
model. So after deleting recordings, restart `pnpm dev:record`, or it keeps answering from
the deleted ones.

## What is here

One conversation with `anthropic/claude-sonnet-5-5`, recorded 2026-11-17 in the browser
against the local stand-in toolkit: "Build an automation that makes short clips with
captions from each new recording I upload.", then, on the automation it built, "Add captions
to the clips before they go for approval." (it already had captions, so the model added the
approval step). `packages/automation-core/test/recorded-model.test.ts` makes its changes
against the real rules, so a rule change that would trip the model fails a test.

One review room answer, recorded 2026-11-17 by the browser tests (`RECORD_AGENT=1 pnpm
test:e2e`): Maya asks "@Agent does this part move too fast?" at 0:02 of "Why the station
matters", with the still, the frames around the moment and the toolkit's measurements of
the clip. The model said it is one continuous shot with no cuts and described the motion
across the frames. The browser tests play this answer back. Its match was cut down to the
question line, so the replay still works when the automation outline or FFmpeg's numbers
shift a little; the Convex tests check what is sent.
