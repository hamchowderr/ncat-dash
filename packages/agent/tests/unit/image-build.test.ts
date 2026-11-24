import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { slimOutput } from "../../scripts/slim-output.mjs";

const repo = join(__dirname, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

function fakeOutput() {
  const out = mkdtempSync(join(tmpdir(), "mastra-output-"));
  const bin = join(
    out,
    "node_modules/.pnpm/onnxruntime-node@1.30.0/node_modules/onnxruntime-node/bin/napi-v6",
  );
  for (const dir of ["linux/x64", "linux/arm64", "darwin/arm64", "win32/x64"]) {
    mkdirSync(join(bin, dir), { recursive: true });
    writeFileSync(join(bin, dir, "libonnxruntime.so"), "native");
  }
  return { out, bin };
}

describe("slimming the mastra build output for the image", () => {
  it("keeps only the onnxruntime binaries for the image platform", () => {
    const { out, bin } = fakeOutput();
    const removed = slimOutput(out, { platform: "linux", arch: "x64" });
    expect(existsSync(join(bin, "linux/x64/libonnxruntime.so"))).toBe(true);
    expect(existsSync(join(bin, "linux/arm64"))).toBe(false);
    expect(existsSync(join(bin, "darwin"))).toBe(false);
    expect(existsSync(join(bin, "win32"))).toBe(false);
    expect(removed).toHaveLength(3);
  });

  it("keeps the arm64 copy on an arm64 server", () => {
    const { out, bin } = fakeOutput();
    slimOutput(out, { platform: "linux", arch: "arm64" });
    expect(existsSync(join(bin, "linux/arm64/libonnxruntime.so"))).toBe(true);
    expect(existsSync(join(bin, "linux/x64"))).toBe(false);
  });

  it("does nothing when there is no onnxruntime", () => {
    const out = mkdtempSync(join(tmpdir(), "mastra-output-"));
    expect(slimOutput(out)).toEqual([]);
  });
});

describe("the image GitHub builds is the one the server deploys", () => {
  const workflow = read(".github/workflows/agent-image.yml");
  const release = read("packages/agent/Dockerfile.release");
  const dockerfile = read("packages/agent/Dockerfile");

  it("the release Dockerfile pulls the tag the workflow publishes", () => {
    // ghcr.io/${{ github.repository }}-agent:sha-<commit>, both processors under one tag
    expect(workflow).toContain("IMAGE: ghcr.io/${{ github.repository }}-agent");
    expect(workflow).toContain('-t "$IMAGE:sha-$GITHUB_SHA"');
    expect(release).toContain("FROM ghcr.io/hamchowderr/takewon-agent:sha-${SOURCE_COMMIT}");
    expect(release).toMatch(/^ARG SOURCE_COMMIT$/m);
  });

  it("the release branch moves only after the image is published", () => {
    // After both halves are joined under the commit's tag, not after the first half.
    const publish = workflow.indexOf("name: Join the two halves under one name");
    const releaseStep = workflow.indexOf("refs/heads/agent-release");
    expect(publish).toBeGreaterThan(0);
    expect(releaseStep).toBeGreaterThan(publish);
  });

  it("the workflow builds the Dockerfile that runs the slimming step", () => {
    expect(workflow).toContain("file: packages/agent/Dockerfile");
    expect(dockerfile).toContain("scripts/slim-output.mjs");
  });

  it("the image has wget for the server health check and skips foreign binaries", () => {
    expect(dockerfile).toMatch(/apt-get install[^\n]*\bwget\b/);
    expect(dockerfile).toContain("libc: [glibc]");
  });

  it("the pnpm store cache id matches between the workflow and the Dockerfile", () => {
    expect(workflow).toContain('"id": "pnpm-store"');
    expect(workflow).toContain('"target": "/pnpm/store"');
    expect(dockerfile).toContain("id=pnpm-store,target=/pnpm/store");
  });
});

describe("the agent image", () => {
  it("never gives the agent a shell on the server", () => {
    expect(read("packages/agent/Dockerfile")).toMatch(/WORKSPACE_SANDBOX=false/);
  });
});
