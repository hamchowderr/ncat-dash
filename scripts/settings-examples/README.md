# Settings examples

The short clips that play beside the options in Settings > Motion and Settings > Captions
(`public/examples/`). They are made with the toolkit's own code, so each one is what a run
really draws, from a public-domain NASA interview recorded on the Space Station.

## What it needs

- The toolkit fork checked out (`hamchowderr/no-code-architects-toolkit`), with its fonts
  installed (`cp fonts/* ~/.fonts && fc-cache -f`) and `numpy` and `matplotlib` for Python.
- HyperFrames 0.9.70 (`npm install hyperframes@0.9.70`) and Chromium, set in
  `HYPERFRAMES_BIN` and `HYPERFRAMES_BROWSER_PATH`.
- FFmpeg.

## Making them

In a work folder:

1. `base.mp4`: 13.5 seconds of the clip from 0:16, at 432x768, 30 fps. `capbase.mp4`: 9.9
   seconds from 0:15 at full size. `words.json`: its words with their times, from
   faster-whisper `small.en` (`[{"w", "s", "e"}]`, seconds in the full clip).
2. `logo.png`: a stand-in logo for the Logo piece.
3. `presets.json`: `MOTION_PRESETS` from `@takewon/automation-core`, as `[{id, name, style}]`.

Then:

```bash
python3 motion_examples.py TOOLKIT_DIR WORK_DIR public/examples/motion
python3 caption_examples.py TOOLKIT_DIR WORK_DIR public/examples/captions caption-styles.json
```

`caption-styles.json` is the built-in caption styles (`BUILT_IN_STYLES`). The caption
script also writes `words.json`; copy those words into
`src/components/settings/caption-example-words.ts` and delete the file. `plain.mp4` is
`capbase.mp4` at 432x768 with no captions, for the styles drawn live.

`src/components/settings/settings-examples.test.tsx` fails when a preset, piece, look or
built-in caption style has no clip, so a new one needs its clip made here.
