/**
 * Music that dips while someone talks and comes back up in the pauses (sidechain ducking),
 * the way editors' auto-ducking works (Premiere's Essential Sound, Resolve's ducking,
 * CapCut's). FFmpeg's sidechaincompress turns the music down by how loud the voice is:
 * past a threshold near quiet speech, by a ratio that takes normal speech about 10 dB under
 * the level it plays at in the pauses. A quick attack so the first word is never covered,
 * a slow release so the music does not pump up between words.
 */

/** How music sits under the voice: dipping while someone talks, or at one level throughout. */
export const MUSIC_UNDER_SPEECH = ["dips while someone talks", "stays at one level"] as const;
export type MusicUnderSpeech = (typeof MUSIC_UNDER_SPEECH)[number];

export const DUCKING = {
  // About -26 dB: quieter than any speech, louder than room hiss.
  threshold: 0.05,
  ratio: 4,
  attack: 20,
  release: 600,
} as const;

/**
 * Filters that mix `voice` with `music` dipping under it, into `out`. Both labels must be
 * ready (resampled to one rate and layout); `length` is amix's duration ("first" or
 * "longest"), and the voice comes first.
 */
export function duckedMix(
  voice: string,
  music: string,
  out: string,
  length: "first" | "longest" = "first",
): string[] {
  const { threshold, ratio, attack, release } = DUCKING;
  return [
    `[${voice}]asplit=2[${voice}_mix][${voice}_key]`,
    `[${music}][${voice}_key]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[${music}_ducked]`,
    `[${voice}_mix][${music}_ducked]amix=inputs=2:duration=${length}:dropout_transition=0:normalize=0[${out}]`,
  ];
}
