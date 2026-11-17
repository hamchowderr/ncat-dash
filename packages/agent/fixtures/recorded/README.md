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
