import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { explainFailure } from "../src/failure-text";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("explainFailure", () => {
  test("a still image given to a step that needs sound says so in plain words", () => {
    const log = `Failed to load audio: ${fixture("ffmpeg-still-image.txt")}`;
    const explained = explainFailure(log);
    expect(explained.reason).toBe(
      "This file is a still image. This step needs a video or audio file.",
    );
    expect(explained.details).toBe(log.trim());
  });

  test("an older error cut off after the banner still names a still image", () => {
    const cut = fixture("ffmpeg-still-image.txt").split("  Stream #0:0")[0];
    expect(explainFailure(cut).reason).toBe(
      "This file is a still image. This step needs a video or audio file.",
    );
  });

  test("an FFmpeg failure with no friendly wording shows its first real error line", () => {
    const explained = explainFailure(`FFmpeg error: ${fixture("ffmpeg-unknown-encoder.txt")}`);
    expect(explained.reason).toBe("FFmpeg error: Unknown encoder 'nosuchcodec'");
    expect(explained.reason).not.toContain("configuration");
    expect(explained.details).toContain("ffmpeg version");
  });

  test("a video with no sound track", () => {
    const log = [
      "ffmpeg version 6.1 Copyright (c) 2000-2023 the FFmpeg developers",
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
      "  Duration: 00:00:05.00, start: 0.000000, bitrate: 500 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1280x720, 25 fps",
      "Output #0, s16le, to 'pipe:':",
      "[out#0/s16le @ 0x55] Output file does not contain any stream",
    ].join("\n");
    expect(explainFailure(log).reason).toBe("This file has no sound to work with.");
  });

  test("short plain messages stay as they are, with nothing to fold away", () => {
    expect(explainFailure("Could not download the file.")).toEqual({
      reason: "Could not download the file.",
      details: null,
    });
    expect(explainFailure("")).toEqual({ reason: "The step failed.", details: null });
    expect(explainFailure(null).reason).toBe("The step failed.");
  });

  test("a long or many-line message keeps its first line as the reason", () => {
    const explained = explainFailure("Traceback: something broke\n  at line 4\n  at line 9");
    expect(explained.reason).toBe("Traceback: something broke");
    expect(explained.details).toContain("at line 9");
    expect(explainFailure("x".repeat(500)).reason.length).toBeLessThanOrEqual(240);
  });

  test("network errors from code are said plainly, with the raw text kept for details", () => {
    const local = explainFailure("Error: connect ECONNREFUSED 127.0.0.1:8080");
    expect(local.reason).toBe(
      "The toolkit could not be reached. It is set to an address on this computer, so check the toolkit's address in Settings.",
    );
    expect(local.details).toBe("Error: connect ECONNREFUSED 127.0.0.1:8080");
    expect(explainFailure("TypeError: fetch failed").reason).toBe(
      "The connection to the toolkit dropped. Try again in a moment.",
    );
    expect(explainFailure("getaddrinfo ENOTFOUND toolkit.example.com").reason).toBe(
      "That address could not be found. Check the toolkit's address in Settings.",
    );
    expect(explainFailure("TimeoutError: The operation was aborted due to timeout").reason).toBe(
      "This took too long and was stopped. Try again in a moment.",
    );
    expect(explainFailure("connect ECONNREFUSED 10.0.0.5:8080").reason).toContain(
      "Check that it is running",
    );
  });

  test("toolkit refusals say what the toolkit said, not its raw body", () => {
    const refused = explainFailure(
      'The toolkit refused the job (HTTP 400). {"message": "video_url must be a link"}',
    );
    expect(refused.reason).toBe("The toolkit refused the job: video_url must be a link");
    expect(explainFailure("The toolkit was not ready for the job (HTTP 503). <html>").reason).toBe(
      "The toolkit ran into a problem of its own. Try again in a moment.",
    );
    expect(explainFailure("Toolkit answered 401 for /v1/media/convert").reason).toContain(
      "API key",
    );
  });

  test("an older toolkit without the step says to update it, never its HTML page", () => {
    const flask404 = [
      "<!doctype html>",
      '<html lang="en">',
      "<title>404 Not Found</title>",
      "<h1>Not Found</h1>",
      "<p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>",
    ].join("\n");
    const explained = explainFailure(`The toolkit refused the job (HTTP 404). ${flask404}`);
    expect(explained.reason).toBe(
      "Your toolkit does not have this step yet. Update it to the latest version.",
    );
    expect(explained.details).toContain("The requested URL was not found on the server.");
    expect(explained.details).not.toMatch(/<[a-z!/]/i);

    // The alert keeps only the first line, so an older stored message arrives cut short.
    expect(explainFailure("The toolkit refused the job (HTTP 404). <!doctype html>").reason).toBe(
      "Your toolkit does not have this step yet. Update it to the latest version.",
    );
    expect(explainFailure("The toolkit refused the job (HTTP 405). ").reason).toBe(
      "Your toolkit does not have this step yet. Update it to the latest version.",
    );
  });

  test("a 404 that says what was missing keeps the toolkit's words", () => {
    expect(
      explainFailure('The toolkit refused the job (HTTP 404). {"message": "Job not found"}').reason,
    ).toBe("The toolkit refused the job: Job not found");
  });

  test("any other web page in place of an answer is said plainly", () => {
    const explained = explainFailure(
      "The toolkit refused the job (HTTP 400). <html><head><style>body{color:red}</style></head><body><h1>Bad Request</h1><p>The browser sent a request this server could not understand.</p></body></html>",
    );
    expect(explained.reason).toBe(
      "The toolkit answered with an error page instead of a result. Check that it is running and up to date, and that its address in Settings is right.",
    );
    expect(explained.reason).not.toContain("<");
    expect(explained.details).toContain("Bad Request");
    expect(explained.details).not.toContain("color:red");
    expect(explained.details).not.toContain("<");

    // A proxy's own error page still reads as the toolkit having trouble.
    expect(
      explainFailure(
        "The toolkit was not ready for the job (HTTP 502). <html><head><title>502 Bad Gateway</title></head></html>",
      ).reason,
    ).toBe("The toolkit ran into a problem of its own. Try again in a moment.");
  });

  test("user-facing words never name FFmpeg when a log has no error line", () => {
    const log = "ffmpeg version 6.1 Copyright (c) 2000-2023 the FFmpeg developers\n";
    expect(explainFailure(log).reason).not.toMatch(/ffmpeg/i);
  });

  test("crashes and raw data never reach people as they are", () => {
    for (const raw of [
      "TypeError: Cannot read properties of undefined (reading 'url')",
      "KeyError: 'response'",
      '{"status": "error"}',
      "Error: something\n    at run (runner.js:10:3)",
    ]) {
      const { reason, details } = explainFailure(raw);
      expect(reason).toMatch(/^Something went wrong in this step\./);
      expect(details).toBe(raw);
    }
  });

  test("plain sentences with numbers are left alone", () => {
    expect(explainFailure("The file is over 500 MB.").reason).toBe("The file is over 500 MB.");
  });
});
