/**
 * What the agent reads about motion graphics and sound effects before it builds: the
 * preset styles a step can pick by id, and the pieces each style draws. Taken from
 * motion.ts, so it always matches what the steps really do.
 */
import {
  BUSY_LABELS,
  ENDING_LABELS,
  LOOK_LABELS,
  MOTION_PIECES,
  MOTION_PRESETS,
  type MotionPreset,
  OPENING_LABELS,
  PRESET_GROUPS,
  pieceInfo,
  SOUND_LEVEL_LABELS,
} from "./motion";

const presetLine = (preset: MotionPreset) => {
  const { style } = preset;
  return `- ${preset.id} (${preset.name}): ${preset.bestFor}. ${LOOK_LABELS[style.look]} look, ${BUSY_LABELS[style.busy].toLowerCase()}; ${style.pieces.map((type) => pieceInfo(type).title.toLowerCase()).join(", ")}; opens with ${OPENING_LABELS[style.opening].toLowerCase()}, ends with ${ENDING_LABELS[style.ending].toLowerCase()}; sound ${SOUND_LEVEL_LABELS[style.sound].toLowerCase()}.`;
};

/** The motion guide as plain text, for the agent. */
export function motionGuideText(): string {
  const groups = PRESET_GROUPS.map((group) => {
    const presets = MOTION_PRESETS.filter((preset) => preset.group === group);
    return presets.length ? [`### ${group}`, ...presets.map(presetLine)].join("\n") : "";
  }).filter(Boolean);
  return [
    "## Preset styles",
    'Set a Motion Graphics step\'s style to one of these ids to use it for that step only. Left as the team style, the step uses the style picked in Settings > Motion.',
    ...groups,
    "",
    "## Pieces",
    ...MOTION_PIECES.map((piece) => `- ${piece.title}: ${piece.description}`),
  ].join("\n");
}
