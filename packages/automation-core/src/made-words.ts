// What each step does to a file, in a word or two, for the names of the files it makes:
// "IMG 4521 captioned", "Space interviews part 2", "Q3 recap with logo". The upload's own
// name stays as the person gave it; these words say what was done to it, so every output
// is told apart even when the upload's name says little.
//
// A step left out (one a team wrote itself, an upload to storage, a thumbnail) falls back to what the
// file is: "clip", "audio", "image".

const MADE_WORDS: Record<string, string> = {
  // Video
  "video-caption": "captioned",
  "video-trim": "trimmed",
  "video-cut": "cut down",
  "video-split": "part",
  "video-concatenate": "joined",
  "video-reframe": "reframed",
  "video-background": "new background",
  "video-cutout": "cutout",
  "video-motion": "with motion graphics",
  // Sound
  "audio-concatenate": "joined audio",
  "media-to-mp3": "MP3",
  // Files of any kind
  "media-convert": "converted",
  "media-generate-ass": "caption file",
  "media-transcribe": "transcript",
  "image-to-video": "video",
  "image-screenshot-webpage": "screenshot",
  "ffmpeg-compose": "edit",
  // Ready-made edits
  "recipe-join-videos": "joined",
  "recipe-clip": "clip",
  "recipe-crop-vertical": "vertical",
  "recipe-frame": "still",
  "recipe-logo": "with logo",
  "recipe-picture-on-picture": "with picture",
  "recipe-picture-on-video": "with picture",
  "recipe-reaction": "reaction",
  "recipe-background-music": "with music",
  "recipe-text-on-picture": "with text",
  "recipe-certificate": "certificate",
  "recipe-text": "with text",
  "recipe-text-scrolling": "with scrolling text",
  "recipe-text-bouncing": "with bouncing text",
  "recipe-text-shadow": "with text",
  "recipe-text-outline": "with text",
  "recipe-text-box": "with text",
  "recipe-text-fade-in": "with text",
  "recipe-text-see-through": "with text",
  "recipe-text-timestamp": "with clock",
  "recipe-text-rotated": "tilted",
  "recipe-text-mirrored": "mirrored",
  "recipe-blur-fill": "with blurred background",
  "recipe-cover-art-video": "with cover art",
  "recipe-loudness": "levelled",
  "recipe-web-ready": "web ready",
  "recipe-gif-preview": "GIF preview",
  "recipe-voice-master": "clean voice",
  "recipe-picture-in-picture": "picture in picture",
  "recipe-stack": "stacked",
  "recipe-side-by-side": "side by side",
  "recipe-green-screen": "green screen",
  "recipe-quote-card": "quote card",
  "recipe-video-card": "with card",
  "recipe-title-on-picture": "title card",
  "recipe-frame-choices": "frame",
  "recipe-fit-to-voiceover": "fit to voice-over",
  "recipe-slideshow": "slideshow",
  "recipe-intro-outro": "with intro and outro",
  "recipe-change-format": "converted",
  "recipe-hook-variants": "variant",
  "recipe-length-cuts": "cut",
  "recipe-opening-lines": "opening",
  "recipe-song-teasers": "teaser",
  "recipe-variant-music": "with music",
  "recipe-saved-look": "styled",
  "recipe-split-shots": "shot",
  "recipe-beat-cut": "cut to the beat",
};

/** What a step did to a file, such as "captioned", or null when it is not known. */
export function madeWords(stepId: string | null | undefined): string | null {
  return (stepId && MADE_WORDS[stepId]) || null;
}

/** Every step that has its own words, for the check that no catalog step is missed. */
export function stepsWithMadeWords(): string[] {
  return Object.keys(MADE_WORDS);
}
