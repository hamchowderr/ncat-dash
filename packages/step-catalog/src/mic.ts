import { z } from "zod";
import { StepSetupError, type StepDefinition } from "./define";
import { composeParts } from "./editing";

/**
 * A separate mic recording (a lav, a phone in a pocket, a recorder) swapped in for the
 * camera's own sound, in sync. The toolkit lines the two up from their sound alone
 * (/v1/audio/align, no AI, no clapperboard): how far apart they started and how far the
 * two clocks drift. Then one FFmpeg request through /v1/ffmpeg/compose trims or delays the
 * mic to match, corrects the drift, and lays it under the picture, which is not re-encoded.
 */

const { opt, url, number, seconds, editStep } = composeParts;

export const SEPARATE_MIC_STEP = "recipe-separate-mic";

/** Drift below this (one part in a million) is left alone: under 4 ms an hour. */
const NO_DRIFT = 1e-6;

/**
 * The filters that bring the mic's sound (input 1) in line with the camera's picture: the
 * sound at `t` seconds into the video is at `t * (1 + drift) + offset` into the mic.
 */
export function micInSync(offset: number, drift: number): string {
  const steps = ["aresample=48000", "aformat=channel_layouts=stereo"];
  // The mic started first: its first `offset` seconds were before the camera rolled.
  if (offset > 0) steps.push(`atrim=start=${offset.toFixed(4)}`, "asetpts=PTS-STARTPTS");
  // Its clock ran fast or slow: played that much quicker or slower, in pitch.
  if (Math.abs(drift) >= NO_DRIFT) steps.push(`atempo=${(1 + drift).toFixed(8)}`);
  // The camera started first: silence until the mic began.
  if (offset < 0) {
    steps.push(`adelay=delays=${Math.round((-offset / (1 + drift)) * 1000)}:all=1`);
  }
  return `[1:a]${steps.join(",")}`;
}

export const micRecipes: StepDefinition[] = [
  editStep({
    id: SEPARATE_MIC_STEP,
    title: "Use A Separate Mic Recording",
    description:
      "Swaps the camera's own sound for a separate mic recording of the same take, such as a lav, a recorder or a phone, lined up to the picture by the sound itself, with no clapperboard and no AI. It also corrects the two devices' clocks drifting apart over a long take. The picture is left as it is. Both the video and the mic recording need sound, and the camera's sound is only used to line them up.",
    primaryInput: "video_url",
    readsFirst: ["video_url", "mic_url"],
    readsSync: { field: "mic_url", against: "video_url" },
    askFirst: ["mic_url"],
    blanks: {
      video_url: url("The camera video"),
      mic_url: url("The mic recording of the same take").meta({ title: "Mic recording" }),
      mic_volume: number("Loudness of the mic (1 is the recording as it is)", 0, 4).default(1),
      nudge_ms: number(
        "Move the mic's sound later (more than 0) or earlier (less than 0), in milliseconds, if it still looks a little off",
        -1000,
        1000,
      ).default(0),
    },
    toRequest: (b, facts) => {
      const video = facts.video_url;
      const duration = video?.duration;
      if (!duration) throw new StepSetupError("The video's length could not be read.");
      if (video?.hasAudio === false) {
        throw new StepSetupError(
          "The video has no sound of its own, so there is nothing to line the mic recording up by.",
        );
      }
      if (facts.mic_url?.hasAudio === false) {
        throw new StepSetupError("The mic recording has no sound.");
      }
      const sync = facts.mic_url?.sync;
      if (!sync) {
        throw new StepSetupError(
          "The mic recording could not be lined up with the video. Try again; if it keeps happening, your toolkit may need updating.",
        );
      }
      if (!sync.matched) {
        throw new StepSetupError(
          "The mic recording and the video don't share enough sound to line them up. Check the mic recording is of the same take, and that the camera recorded its own sound too.",
        );
      }
      const offset = sync.offset - b.nudge_ms / 1000;
      return {
        inputs: [{ file_url: b.video_url }, { file_url: b.mic_url }],
        filters: [
          {
            filter: `${micInSync(offset, sync.drift)},volume=${b.mic_volume},apad,atrim=duration=${seconds(duration)}[mic]`,
          },
        ],
        outputs: [
          {
            options: [
              opt("-map", "0:v"),
              opt("-map", "[mic]"),
              // The picture is left as it is; only the sound is made again.
              opt("-c:v", "copy"),
              opt("-c:a", "aac"),
              opt("-b:a", "192k"),
              opt("-t", seconds(duration)),
              opt("-movflags", "+faststart"),
              opt("-f", "mp4"),
            ],
          },
        ],
      };
    },
  }),
];
