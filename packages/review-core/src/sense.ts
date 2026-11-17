// What the agent is told about a clip beyond one still: frames around the moment, where
// the cuts are, how loud it is, where it goes quiet, and what is said near the moment.
// The team's own toolkit measures all of it; these are the rules for asking and reading.

/** Seconds of frames shown around the moment, and how many frames a second. */
export const FRAMES_SPAN = 6;
export const FRAMES_PER_SECOND = 2;
/** The frames come as one picture: 4 across, 3 down, in reading order. */
export const FRAMES_GRID = { across: 4, down: 3 } as const;
/** Seconds of sound transcribed around the moment. */
export const LISTEN_SPAN = 30;
/** Cuts and quiet gaps this close to the moment are named one by one. */
export const NEAR = 10;

export type Window = { start: number; length: number };

const round = (value: number) => Math.round(value * 100) / 100;

/** A stretch of the clip around the moment, kept inside the clip where its length is known. */
export function windowAround(moment: number, span: number, duration: number | null): Window {
  const latest = duration === null ? Number.POSITIVE_INFINITY : Math.max(duration - span, 0);
  const start = Math.min(Math.max(moment - span / 2, 0), latest);
  const length = duration === null ? span : Math.min(span, Math.max(duration - start, 0));
  return { start: round(start), length: round(length) };
}

/**
 * Python the toolkit runs (its /v1/code/execute/python) to measure a clip with FFmpeg:
 * its length, where the picture cuts, its loudness overall and around the moment, and
 * its quiet gaps. The address goes in as a JSON string, so it cannot break out of it.
 */
export function measureCode(url: string, moment: number): string {
  const safeMoment = Number.isFinite(moment) ? Math.max(moment, 0) : 0;
  return `import json, re, subprocess
url = json.loads(${JSON.stringify(JSON.stringify(url))})
moment = ${safeMoment}
def run(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=25).stderr
    except Exception:
        return None
out = {"duration": None, "cuts": None, "loudness": None, "loudnessAtMoment": None, "silences": [], "hasAudio": False}
try:
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", url], capture_output=True, text=True, timeout=15).stdout
    info = json.loads(probe)
    out["duration"] = round(float(info["format"]["duration"]), 2)
    out["hasAudio"] = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
except Exception:
    pass
log = run(["ffmpeg", "-hide_banner", "-nostats", "-i", url, "-an", "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-f", "null", "-"])
if log is not None:
    out["cuts"] = [round(float(t), 2) for t in re.findall(r"pts_time:([0-9.]+)", log)][:300]
if out["hasAudio"]:
    log = run(["ffmpeg", "-hide_banner", "-nostats", "-i", url, "-vn", "-af", "ebur128,silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"])
    log = log or ""
    found = re.findall(r"I:\\s+(-?[0-9.]+) LUFS", log)
    if found:
        out["loudness"] = float(found[-1])
    starts = [float(s) for s in re.findall(r"silence_start: (-?[0-9.]+)", log)]
    ends = [float(e) for e in re.findall(r"silence_end: ([0-9.]+)", log)]
    out["silences"] = [{"start": round(max(s, 0), 2), "end": round(ends[i], 2) if i < len(ends) else out["duration"]} for i, s in enumerate(starts)][:100]
    window = run(["ffmpeg", "-hide_banner", "-nostats", "-ss", str(max(moment - 1.5, 0)), "-t", "3", "-i", url, "-vn", "-af", "ebur128", "-f", "null", "-"])
    found = re.findall(r"I:\\s+(-?[0-9.]+) LUFS", window or "")
    if found:
        out["loudnessAtMoment"] = float(found[-1])
return out`;
}

export type Measurements = {
  duration: number | null;
  /** Null when the clip was too long to look through in time. */
  cuts: number[] | null;
  loudness: number | null;
  loudnessAtMoment: number | null;
  silences: { start: number; end: number | null }[];
  hasAudio: boolean;
};

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The toolkit's measurements, or null when what came back is not them. */
export function readMeasurements(value: unknown): Measurements | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if ((raw.cuts !== null && !Array.isArray(raw.cuts)) || !Array.isArray(raw.silences)) return null;
  return {
    duration: numberOrNull(raw.duration),
    cuts: Array.isArray(raw.cuts)
      ? raw.cuts.filter((cut): cut is number => numberOrNull(cut) !== null).sort((a, b) => a - b)
      : null,
    loudness: numberOrNull(raw.loudness),
    loudnessAtMoment: numberOrNull(raw.loudnessAtMoment),
    silences: raw.silences.flatMap((gap) => {
      const start = numberOrNull((gap as { start?: unknown })?.start);
      return start === null ? [] : [{ start, end: numberOrNull((gap as { end?: unknown }).end) }];
    }),
    hasAudio: raw.hasAudio === true,
  };
}

export type Pacing = {
  cuts: number;
  averageShot: number | null;
  shot: { start: number; end: number | null };
  cutsNear: number[];
};

/** How the clip is cut: how many cuts, how long a shot runs, and the shot the moment is in. */
export function pacingOf(cuts: number[], duration: number | null, moment: number): Pacing {
  const before = cuts.filter((cut) => cut <= moment);
  const after = cuts.filter((cut) => cut > moment);
  const shots = cuts.length + 1;
  return {
    cuts: cuts.length,
    averageShot: duration === null ? null : round(duration / shots),
    shot: { start: before.length ? before[before.length - 1] : 0, end: after[0] ?? duration },
    cutsNear: cuts.filter((cut) => Math.abs(cut - moment) <= NEAR),
  };
}

export type Line = { at: number; text: string };

/**
 * What is said near the moment, from the toolkit's transcript of the stretch starting at
 * `offset`, with times on the clip's own clock.
 */
export function transcriptNear(segments: unknown, offset: number): Line[] {
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment) => {
    const start = numberOrNull((segment as { start?: unknown })?.start);
    const text = (segment as { text?: unknown })?.text;
    if (start === null || typeof text !== "string" || !text.trim()) return [];
    return [{ at: round(start + offset), text: text.trim().slice(0, 400) }];
  });
}

/** Everything the agent is told about the clip besides the still. */
export type ClipSense = {
  frames: { from: number; every: number; count: number } | null;
  pacing: Pacing | null;
  sound: {
    hasAudio: boolean;
    loudness: number | null;
    loudnessAtMoment: number | null;
    quietNear: { start: number; end: number | null }[];
  } | null;
  transcript: Line[] | null;
};

/** Puts the measurements in the shape the agent reads. */
export function senseFrom(
  measured: Measurements | null,
  moment: number,
  frames: Window | null,
  transcript: Line[] | null,
): ClipSense {
  return {
    frames: frames
      ? {
          from: frames.start,
          every: 1 / FRAMES_PER_SECOND,
          count: Math.min(
            FRAMES_GRID.across * FRAMES_GRID.down,
            Math.max(1, Math.ceil(frames.length * FRAMES_PER_SECOND)),
          ),
        }
      : null,
    pacing: measured?.cuts ? pacingOf(measured.cuts, measured.duration, moment) : null,
    sound: measured
      ? {
          hasAudio: measured.hasAudio,
          loudness: measured.loudness,
          loudnessAtMoment: measured.loudnessAtMoment,
          quietNear: measured.silences.filter(
            (gap) =>
              Math.abs(gap.start - moment) <= NEAR ||
              (gap.end !== null && Math.abs(gap.end - moment) <= NEAR) ||
              (gap.start <= moment && (gap.end === null || gap.end >= moment)),
          ),
        }
      : null,
    transcript,
  };
}
