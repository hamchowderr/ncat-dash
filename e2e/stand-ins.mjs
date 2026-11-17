// Stand-ins for the browser tests: a file server that supports seeking, and a toolkit
// that answers every job at once. Nothing here is used by the product itself. The agent
// server is the real one, with its stand-in model (see playwright.config.ts).
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const FILES_PORT = 8766;
export const TOOLKIT_PORT = 8767;
export const FILES = `http://127.0.0.1:${FILES_PORT}`;
export const CLIPS = ["opening-hello", "why-the-station-matters"];

const clip = fileURLToPath(new URL("./fixtures/clip.webm", import.meta.url));
const still = fileURLToPath(new URL("./fixtures/still.jpg", import.meta.url));

// Every name serves the same short clip, and every .jpg the same still of it.
createServer((request, response) => {
  if (request.url.endsWith(".jpg")) {
    response.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": statSync(still).size,
    });
    createReadStream(still).pipe(response);
    return;
  }
  const size = statSync(clip).size;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
  const head = {
    "Content-Type": "video/webm",
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
    createReadStream(clip, { start, end }).pipe(response);
  } else {
    response.writeHead(200, { ...head, "Content-Length": size });
    createReadStream(clip).pipe(response);
  }
}).listen(FILES_PORT, "127.0.0.1");

createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url.startsWith("/v1/toolkit/authenticate")) {
      response.end(JSON.stringify({ code: 200, response: "Authorized", build_number: "204" }));
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
