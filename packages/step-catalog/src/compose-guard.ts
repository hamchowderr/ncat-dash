/**
 * What a request to the toolkit's /v1/ffmpeg/compose may not ask FFmpeg to do.
 *
 * Compose hands its filters and settings to FFmpeg as they are. FFmpeg can read files on
 * the machine it runs on (drawtext's textfile, movie, a filter option read from a file),
 * write files wherever a bare word names one, and load plugins. On a toolkit that several
 * teams share, that would let one team read the toolkit's own keys (and so every team's
 * files) or change the toolkit itself. Every compose request is checked here before it is
 * sent, whoever wrote it: a ready-made step, a team step, the Custom edit step or the agent.
 *
 * Files only ever come in as links (the toolkit downloads them), so nothing a real edit
 * needs is refused.
 */

/** Filters that read or write files, run commands or load code. */
const BLOCKED_FILTERS = new Set([
  "movie",
  "amovie",
  "sendcmd",
  "asendcmd",
  "zmq",
  "azmq",
  "frei0r",
  "frei0r_src",
  "ladspa",
  "lv2",
  "lut3d",
  "lut1d",
  "lut",
  "dnn_processing",
  "dnn_classify",
  "dnn_detect",
  "sr",
  "derain",
  "dejudder_file",
  "vidstabdetect",
  "vidstabtransform",
  "ocr",
  "signature",
  "vmafmotion",
  "libvmaf",
  "psnr",
  "ssim",
  "qrencode",
  "qrencodesrc",
]);

/** Filter options whose value FFmpeg reads as a file on its own machine. */
const FILE_OPTIONS = new Set([
  "textfile",
  "fontfile",
  "filename",
  "file",
  "stats_file",
  "log_path",
  "model",
  "fontsdir",
]);

/** Filters that may name a file, as long as it is a link the toolkit downloads. */
const LINK_FILTERS = new Set(["subtitles", "ass"]);

/** Settings that read or write files, or change where FFmpeg reads and writes. */
const BLOCKED_OPTIONS = new Set([
  "-i",
  "-filter_script",
  "-filter_complex_script",
  "-attach",
  "-dump_attachment",
  "-protocol_whitelist",
  "-protocol_blacklist",
  "-vstats",
  "-vstats_file",
  "-passlogfile",
  "-sdp_file",
  "-progress",
  "-report",
  "-init_hw_device",
  "-filter_hw_device",
  "-hwaccel_device",
  "-qsv_device",
  "-vaapi_device",
  "-stats_period",
  "-benchmark_all",
  "-dump",
  "-hex",
  "-fpre",
  "-pre",
  "-apre",
  "-vpre",
  "-spre",
]);

/** Settings whose value is a filter graph, checked like a filter. */
const FILTER_OPTIONS = /^-(vf|af|filter(:[avs](:\d+)?)?|filter_complex|lavfi)$/;

/** Formats that read other files named inside the input, or a whole pattern of files. */
const BLOCKED_FORMATS = new Set(["concat", "hls", "lavfi", "image2", "image2pipe", "ffconcat"]);

const OPTION = /^-[A-Za-z0-9][A-Za-z0-9_:.+-]{0,60}$/;
const LINK = /https?:\/\/[^\s'"\\\]\[;,]+/g;

type Option = { option?: unknown; argument?: unknown };

/** Why a filter graph is refused, or null. */
export function filterProblem(graph: string): string | null {
  // Links are files the toolkit downloads, so whatever is inside one is not a path. Then
  // escaped characters and quoted words (a caption's text) are set aside: FFmpeg reads
  // them as plain text, never as a filter, a setting or a file.
  const plain = graph
    .replace(/'(https?:\/\/[^']*)'/g, "LINK")
    .replace(LINK, "LINK")
    .replace(/\\./g, "E")
    .replace(/'[^']*'/g, "Q");
  if (/\b(file|pipe|fd|subfile|concat|tcp|udp|unix):/i.test(plain)) {
    return "A filter names a local file or connection. Use a link instead.";
  }
  // Each filter in the chain: its name, then its settings.
  for (const raw of plain.split(/[;,]/)) {
    const part = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!part) continue;
    const at = part.indexOf("=");
    const filter = (at === -1 ? part : part.slice(0, at)).trim().toLowerCase().replace(/@.*$/, "");
    if (filter.startsWith("/")) return "A filter reads its settings from a file.";
    if (BLOCKED_FILTERS.has(filter)) return `The ${filter} filter is not available here.`;
    if (at === -1) continue;
    const settings = part.slice(at + 1).split(":");
    for (const [index, setting] of settings.entries()) {
      const equals = setting.indexOf("=");
      const key = equals === -1 ? null : setting.slice(0, equals).trim().toLowerCase();
      const value = (equals === -1 ? setting : setting.slice(equals + 1)).trim();
      // FFmpeg 7 reads a setting written "/name=path" from the file at path.
      if (key?.startsWith("/")) return "A filter reads one of its settings from a file.";
      const namesFile =
        (key !== null && FILE_OPTIONS.has(key)) ||
        (key === null && index === 0 && LINK_FILTERS.has(filter));
      if (namesFile && value !== "LINK") {
        return `The ${filter} filter would read a file on the toolkit. Give it a link instead.`;
      }
    }
  }
  return null;
}

function optionProblem(entry: Option, where: "global" | "input" | "output"): string | null {
  const option = typeof entry.option === "string" ? entry.option.trim() : "";
  if (!OPTION.test(option)) {
    return `"${String(entry.option).slice(0, 40)}" is not an FFmpeg setting. Settings start with a dash.`;
  }
  const name = option.toLowerCase();
  if (BLOCKED_OPTIONS.has(name)) return `The ${option} setting is not available here.`;
  const argument = entry.argument;
  if (argument === undefined || argument === null || typeof argument === "number") return null;
  if (typeof argument !== "string") return `The ${option} setting has a value FFmpeg can't use.`;
  if (FILTER_OPTIONS.test(name)) return filterProblem(argument);
  if (name === "-f" && BLOCKED_FORMATS.has(argument.trim().toLowerCase()) && where !== "output") {
    return `Reading files as ${argument} is not available here.`;
  }
  const value = argument.trim();
  if (/^(file|pipe|fd|tcp|udp|unix|data|subfile|concat|tee):/i.test(value)) {
    return `The ${option} setting names a local file or connection.`;
  }
  if (/^[/~\\]|\.\.[/\\]|[A-Za-z]:[/\\]/.test(value)) {
    return `The ${option} setting names a file on the toolkit.`;
  }
  return null;
}

/**
 * Why a compose request is refused, in plain words, or null when it may be sent. Its
 * inputs must be links, and nothing in it may read, write or load a file on the toolkit.
 */
export function composeProblem(request: Record<string, unknown>): string | null {
  const inputs = Array.isArray(request.inputs) ? request.inputs : [];
  for (const input of inputs as { file_url?: unknown; options?: unknown }[]) {
    if (typeof input?.file_url !== "string" || !/^https?:\/\//i.test(input.file_url)) {
      return "Every file in a custom edit must be a link.";
    }
    for (const option of Array.isArray(input.options) ? (input.options as Option[]) : []) {
      const problem = optionProblem(option, "input");
      if (problem) return problem;
    }
  }
  for (const option of Array.isArray(request.global_options)
    ? (request.global_options as Option[])
    : []) {
    const problem = optionProblem(option, "global");
    if (problem) return problem;
  }
  for (const filter of Array.isArray(request.filters)
    ? (request.filters as { filter?: unknown }[])
    : []) {
    if (typeof filter?.filter !== "string") return "A filter is not text.";
    const problem = filterProblem(filter.filter);
    if (problem) return problem;
  }
  for (const output of Array.isArray(request.outputs)
    ? (request.outputs as { options?: unknown }[])
    : []) {
    for (const option of Array.isArray(output?.options) ? (output.options as Option[]) : []) {
      const problem = optionProblem(option, "output");
      if (problem) return problem;
    }
  }
  return null;
}
