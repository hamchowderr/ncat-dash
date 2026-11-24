// Stand-ins for the browser tests: a file server that supports seeking, and a toolkit
// (the fork, with its storage requests) that answers every job at once. Nothing here is used by the product itself. The agent
// server is the real one, with its model played back (see playwright.config.ts).
//
// Two toolkit jobs run for real, as the toolkit runs them, so the agent sees and measures
// the clip: Python (/v1/code/execute/python) and FFmpeg compose (/v1/ffmpeg/compose).
import { execFile } from "node:child_process";
import { createReadStream, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FILES_PORT = 8766;
export const TOOLKIT_PORT = 8767;
export const FILES = `http://127.0.0.1:${FILES_PORT}`;
export const CLIPS = ["opening-hello", "why-the-station-matters"];
/** What the stand-in transcribe says was said in any file. */
/** What every caption file in the stand-in bucket says, as SRT. */
export const CAPTIONS =
  "1\n00:00:01,000 --> 00:00:02,500\nWelcome back to the station.\n\n2\n00:00:03,000 --> 00:00:05,000\nToday we talk about pricing your edits.\n";

/** Each word with its timing, as Whisper gives them with word timestamps. */
const timedWords = (text, start, step) =>
  text
    .trim()
    .split(" ")
    .map((word, index) => ({
      word: ` ${word}`,
      start: start + index * step,
      end: start + index * step + step * 0.8,
    }));

export const SEGMENTS = [
  {
    id: 0,
    start: 0,
    end: 2.5,
    text: " Welcome back to the station.",
    tokens: [1],
    words: timedWords("Welcome back to the station.", 0, 0.5),
  },
  {
    id: 1,
    start: 2.5,
    end: 6,
    text: " Today we talk about pricing your edits.",
    tokens: [2],
    words: timedWords("Today we talk about pricing your edits.", 2.5, 0.5),
  },
];

const clip = fileURLToPath(new URL("./fixtures/clip.webm", import.meta.url));
// For a screen recording on real footage: STAND_IN_CLIP is served instead of the short
// clip, and STAND_IN_PLAIN for any name with "plain" in it. Their details and camera cuts
// are then read from the files themselves.
const ownClip = process.env.STAND_IN_CLIP ?? null;
const plainClip = process.env.STAND_IN_PLAIN ?? null;
const clipFor = (url) => (plainClip && /plain/.test(url) ? plainClip : (ownClip ?? clip));
const still = fileURLToPath(new URL("./fixtures/still.jpg", import.meta.url));
// Files the real jobs make, served at /made/<name>.
const made = mkdtempSync(join(tmpdir(), "takewon-e2e-made-"));
let jobs = 0;
// The bucket's folders, so a folder can be picked and made. Files are not kept.
const folders = new Set(["incoming/", "podcast/", "podcast/raw/"]);

// Parts sent to the bucket for uploads in parts: upload id -> { key, parts: part -> bytes }.
const partUploads = new Map();
// Uploads in parts that were put together: key -> { parts, bytes }.
const joined = new Map();

const TYPES = { png: "image/png", jpg: "image/jpeg", mp3: "audio/mpeg", mp4: "video/mp4" };

function run(command, args) {
  return new Promise((resolve, reject) =>
    execFile(command, args, { timeout: 120_000, maxBuffer: 1 << 24 }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    ),
  );
}

/** /v1/code/execute/python: the code becomes the body of a function, as the toolkit does. */
async function python(body) {
  const indented = String(body.code)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  const script = join(made, `job-${++jobs}.py`);
  writeFileSync(
    script,
    `import json\ndef execute_code():\n${indented}\nprint(json.dumps({"result": execute_code()}))\n`,
  );
  return JSON.parse(await run("python3", [script]));
}

/** A file's details, as the toolkit's metadata request gives them. */
async function probe(file) {
  const read = JSON.parse(
    await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]),
  );
  const video = read.streams.find((one) => one.codec_type === "video");
  return {
    duration: Number(read.format.duration),
    format: read.format.format_name,
    has_video: Boolean(video),
    has_audio: read.streams.some((one) => one.codec_type === "audio"),
    width: video?.width,
    height: video?.height,
    fps: 25,
    video_codec: video?.codec_name,
  };
}

/** A file's camera cuts, found by FFmpeg's scene change score. */
async function cutsIn(file) {
  const log = await new Promise((resolve) =>
    execFile(
      "ffmpeg",
      ["-i", file, "-filter:v", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"],
      { timeout: 120_000, maxBuffer: 1 << 24 },
      (_error, _stdout, stderr) => resolve(stderr),
    ),
  );
  const cuts = [...String(log).matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]));
  return { duration: (await probe(file)).duration, cuts };
}

/** /v1/ffmpeg/compose: the same command the toolkit builds, with its files served here. */
async function compose(body) {
  const flags = (options = []) =>
    options.flatMap((o) => (o.argument == null ? [o.option] : [o.option, String(o.argument)]));
  const args = ["-y", ...flags(body.global_options)];
  for (const input of body.inputs) args.push(...flags(input.options), "-i", input.file_url);
  if (body.filters?.length)
    args.push("-filter_complex", body.filters.map((f) => f.filter).join(";"));
  const job = ++jobs;
  const outputs = body.outputs.map((output, index) => {
    const format = output.options.find((o) => o.option === "-f")?.argument;
    const extension = format === "image2" ? "png" : (format ?? "mp4");
    const file = join(made, `job-${job}-output-${index}.${extension}`);
    args.push(...flags(output.options), file);
    return file;
  });
  await run("ffmpeg", args);
  return outputs.map((file) => ({ file_url: `${FILES}/made/${basename(file)}` }));
}

// Every name serves the same short clip, and every .jpg the same still of it.
createServer((request, response) => {
  // An upload from the browser: the bucket takes the bytes (and allows the PUT first).
  if (request.method === "OPTIONS" || request.method === "PUT") {
    // A part of an upload in parts: its link names the upload and the part.
    const link = new URL(request.url, FILES);
    const part = Number(link.searchParams.get("partNumber"));
    const into = partUploads.get(link.searchParams.get("uploadId"));
    let bytes = 0;
    request.on("data", (chunk) => (bytes += chunk.length));
    request.on("end", () => {
      if (request.method === "PUT" && into && part) into.parts.set(part, bytes);
      response
        .writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT",
          "Access-Control-Allow-Headers": "*",
          // As the bucket's CORS rule must, so the browser can read each part's ETag.
          "Access-Control-Expose-Headers": "ETag",
          ETag: `"part-${part || "whole"}"`,
        })
        .end();
    });
    return;
  }
  // What the stand-in transcribe "heard", in Whisper's shape, as the toolkit uploads it.
  if (request.url.startsWith("/segments.json")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(SEGMENTS));
    return;
  }
  if (request.url.startsWith("/made/")) {
    const file = join(made, basename(request.url));
    const type = TYPES[file.split(".").pop()] ?? "application/octet-stream";
    try {
      response.writeHead(200, { "Content-Type": type, "Content-Length": statSync(file).size });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
    return;
  }
  // Every caption file the bucket is asked for: the same two lines.
  if (/\.(srt|vtt|ass)(\?|$)/.test(request.url)) {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(CAPTIONS);
    return;
  }
  if (request.url.endsWith(".jpg")) {
    response.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": statSync(still).size,
    });
    createReadStream(still).pipe(response);
    return;
  }
  const served = clipFor(request.url);
  const size = statSync(served).size;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
  const head = {
    "Content-Type": served.endsWith(".mp4") ? "video/mp4" : "video/webm",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    response.writeHead(206, {
      ...head,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
    createReadStream(served, { start, end }).pipe(response);
  } else {
    response.writeHead(200, { ...head, "Content-Length": size });
    createReadStream(served).pipe(response);
  }
}).listen(FILES_PORT, "127.0.0.1");

let failing = null;

createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    const real = request.url.startsWith("/v1/code/execute/python")
      ? python
      : request.url.startsWith("/v1/ffmpeg/compose")
        ? compose
        : null;
    if (real) {
      try {
        const result = await real(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: 200, job_id: "stand-in", response: result }));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: 500, message: String(error) }));
      }
      return;
    }
    // A test can make one endpoint refuse its jobs until it says otherwise:
    // POST /__stand-in/fail {"path": "/v1/video/thumbnail"}, and {"path": null} to stop.
    if (request.url === "/__stand-in/fail") {
      failing = JSON.parse(Buffer.concat(chunks).toString() || "{}").path ?? null;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ failing }));
      return;
    }
    if (failing && request.url.startsWith(failing)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ code: 400, message: "The picture time is past the end of the video." }),
      );
      return;
    }
    // A video from a link (yt-dlp). A link with "needs-sign-in" in it answers like YouTube
    // does to a server with no cookies.
    if (request.url.startsWith("/v1/BETA/media/download")) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (String(body.media_url).includes("needs-sign-in") && !body.cookie) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            code: 500,
            message: "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies",
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      const key = String(body.filename ?? "video.mp4").replace(/\.mp4$/, ".webm");
      response.end(
        JSON.stringify({
          code: 200,
          response: {
            media: {
              media_url: `${FILES}/${key}`,
              title: "Crew interview reel",
              ext: "webm",
              width: 180,
              height: 320,
              duration: 6,
            },
          },
          message: "success",
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url.startsWith("/v1/toolkit/health")) {
      // What the fork's health route says about a 4-CPU box with a little work on.
      response.end(
        JSON.stringify({
          code: 200,
          response: {
            build_number: "214",
            cpus: 4,
            cpu_percent: 38.5,
            memory: { used: 2_900_000_000, limit: 8_000_000_000 },
            disk: { free: 59_000_000_000, total: 100_000_000_000 },
            uptime_seconds: 273_600,
            queue: { shared: true, waiting: 1, workers: 4, busy: 2 },
            jobs: { queued: 1, running: 2, done: 318 },
          },
          message: "success",
        }),
      );
      return;
    }
    if (request.url.startsWith("/v1/toolkit/authenticate")) {
      response.end(JSON.stringify({ code: 200, response: "Authorized", build_number: "204" }));
      return;
    }
    // What reached the bucket through uploads in parts, for a test to check.
    if (request.url === "/__stand-in/joined") {
      response.end(JSON.stringify(Object.fromEntries(joined)));
      return;
    }
    // The fork's uploads in parts.
    if (request.url.startsWith("/v1/storage/upload/")) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const step = request.url.slice("/v1/storage/upload/".length);
      let answer = null;
      if (step === "start") {
        const uploadId = `parts-${partUploads.size + joined.size + 1}`;
        partUploads.set(uploadId, { key: body.key, parts: new Map() });
        answer = { key: body.key, upload_id: uploadId };
      } else if (step === "sign") {
        answer = {
          parts: body.part_numbers.map((number) => ({
            part_number: number,
            url: `${FILES}/${body.key}?uploadId=${body.upload_id}&partNumber=${number}`,
          })),
          expires_in: body.expires_in ?? 3600,
        };
      } else if (step === "complete") {
        const upload = partUploads.get(body.upload_id);
        const sent = body.parts.every(
          (part) =>
            upload?.parts.has(part.part_number) && part.etag === `"part-${part.part_number}"`,
        );
        if (!sent) {
          response.end(
            JSON.stringify({ code: 400, response: null, message: "A part is missing." }),
          );
          return;
        }
        joined.set(body.key, {
          parts: body.parts.length,
          bytes: [...upload.parts.values()].reduce((sum, bytes) => sum + bytes, 0),
        });
        partUploads.delete(body.upload_id);
        answer = { key: body.key, etag: `stand-in-${body.parts.length}` };
      } else if (step === "abort") {
        partUploads.delete(body.upload_id);
        answer = { key: body.key, cancelled: true };
      }
      response.end(JSON.stringify({ code: 200, response: answer, message: "success" }));
      return;
    }
    // The fork's storage requests: its bucket is the file server above.
    if (request.url.startsWith("/v1/storage/")) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      // The dashboard keeps each team inside teams/<id>/; every team here gets the same
      // folders, kept from inside its own.
      const asked = String(body.prefix ?? "");
      const team = /^teams\/[^/]+\//.exec(asked)?.[0] ?? "";
      const prefix = asked.slice(team.length);
      if (request.url === "/v1/storage/folder" && prefix) folders.add(prefix);
      // The folders straight inside the one asked about.
      const inside = [...folders]
        .filter(
          (key) =>
            key.startsWith(prefix) && key !== prefix && !key.slice(prefix.length, -1).includes("/"),
        )
        .map((key) => `${team}${key}`);
      const answers = {
        info: { provider: "s3", bucket: "stand-in", endpoint: FILES, public_url: null },
        sign: { url: `${FILES}/${body.key}`, method: body.method ?? "GET" },
        list: { files: [], folders: inside.sort(), next_token: null },
        exists: { exists: false },
        copy: { key: body.destination, etag: "stand-in" },
        delete: { deleted: body.keys ?? [], failed: [] },
        folder: { prefix: body.prefix },
      };
      const answer = answers[request.url.slice("/v1/storage/".length)];
      response.end(JSON.stringify({ code: 200, response: answer ?? null, message: "success" }));
      return;
    }
    // Real footage for a recording: its details and cuts read from the file itself.
    if (ownClip && request.url.startsWith("/v1/media/metadata")) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      response.end(
        JSON.stringify({
          code: 200,
          response: await probe(clipFor(String(body.media_url))),
          message: "success",
        }),
      );
      return;
    }
    if (ownClip && request.url.startsWith("/v1/media/look")) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      response.end(
        JSON.stringify({
          code: 200,
          response: { media: await cutsIn(clipFor(String(body.media_url))) },
          message: "success",
        }),
      );
      return;
    }
    // What the toolkit reads from a file: the stand-in clip's own details.
    if (request.url.startsWith("/v1/media/metadata")) {
      response.end(
        JSON.stringify({
          code: 200,
          response: {
            duration: 6,
            format: "matroska,webm",
            has_video: true,
            has_audio: false,
            width: 180,
            height: 320,
            fps: 25,
            video_codec: "vp9",
          },
          message: "success",
        }),
      );
      return;
    }
    // The footage check measures the stand-in clip: small, upright, with no sound.
    if (request.url.startsWith("/v1/media/check")) {
      response.end(
        JSON.stringify({
          code: 200,
          response: {
            duration: 6,
            has_video: true,
            has_audio: false,
            width: 180,
            height: 320,
            rotation: 0,
            fps: 25,
            checked_seconds: 6,
            black: [],
            frozen: [],
          },
          message: "success",
        }),
      );
      return;
    }
    // A transcription kept as files at the toolkit, as with response_type "cloud".
    if (request.url.startsWith("/v1/media/transcribe")) {
      response.end(
        JSON.stringify({
          code: 200,
          job_id: "stand-in",
          response: {
            text: null,
            srt: null,
            segments: null,
            text_url: null,
            srt_url: null,
            segments_url: `${FILES}/segments.json`,
          },
          message: "success",
        }),
      );
      return;
    }
    // A split answers with its clips, a thumbnail with a still; anything else with one file.
    const result = request.url.startsWith("/v1/video/split")
      ? CLIPS.map((name) => ({ file_url: `${FILES}/${name}.webm` }))
      : request.url.startsWith("/v1/video/thumbnail")
        ? `${FILES}/still.jpg`
        : `${FILES}/tighter-cut.webm`;
    response.end(
      JSON.stringify({ code: 200, job_id: "stand-in", response: result, message: "success" }),
    );
  });
}).listen(TOOLKIT_PORT, "127.0.0.1");
