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
against the local stand-in toolkit, with one video uploaded: "Build an automation that
makes short clips with captions from each new recording I upload." The model first asked
which platforms (`ask_user`, pick several); TikTok and YouTube Shorts were picked. It then
built one clips branch per platform, tried it on the upload (`try_automation`), read how
the run went (`check_run`) and reported. `packages/automation-core/test/recorded-model.test.ts`
checks it asked before building, makes its changes against the real rules, and checks it
tried what it built.

One review room answer, recorded 2026-11-17 by the browser tests (`RECORD_AGENT=1 pnpm
test:e2e`): Maya asks "@Agent does this part move too fast?" at 0:02 of "Why the station
matters", with the still, the frames around the moment and the toolkit's measurements of
the clip. The model said it is one continuous shot with no cuts and described the motion
across the frames. The browser tests play this answer back. Its match was cut down to the
question line, so the replay still works when the automation outline or FFmpeg's numbers
shift a little; the Convex tests check what is sent.

One Slack answer, recorded 2026-11-17 by the browser tests (`RECORD_AGENT=1 pnpm test:e2e
e2e/slack.spec.ts`), against the Slack stand-in (`e2e/slack-stand-in.mjs`): Jordan tags the
agent in a channel with "How many automations does our team have, and what are they
called? Answer in one short sentence." The agent looked it up in the dashboard as Jordan
and said the team has one automation, called "New automation", switched off with no steps
yet. There are three files: the answer itself and the thread title, which a smaller model
writes. Each match was cut down to the question, because Slack shows the bot's tag as
"@Agent" and each run gets its own message id.

One look study, recorded 2026-11-21 by the browser tests (`RECORD_AGENT=1 pnpm test:e2e
e2e/looks.spec.ts`): The dashboard sends the sheet of six frames FFmpeg took from the
stand-in clip, uploaded as "Crew interview reel.webm". The model saw a colour-bar test
pattern filling the frame, no grade and no captions, and said so. Its match was cut down to
the sample's name line.
