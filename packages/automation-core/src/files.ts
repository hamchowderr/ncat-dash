const FAMILIES: Record<string, "video" | "audio" | "image"> = {
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  m4v: "video",
  avi: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  flac: "audio",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
};

/** Whether a file name is video, audio or an image, going by its ending. */
export function fileFamily(name: string): "video" | "audio" | "image" | "other" {
  const ending = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return FAMILIES[ending] ?? "other";
}
