import { allSteps } from "@ncat-dash/step-catalog";
import { describe, expect, it } from "vitest";

import {
  actionTypesByGroup,
  applyOperation,
  applyOperations,
  type AutomationDraft,
  draftProblems,
  getNodeType,
  savedKind,
  graphProblem,
  brandProblem,
  describeFileDetails,
  fileDetailColumns,
  fileDetailRows,
  formatDuration,
  readFileDetails,
  withinLength,
  missingBrandOf,
  missingSettingsOf,
  readUploadRef,
  uploadRef,
  withBrand,
  NODE_GAP,
  NODE_TYPES,
  nodeTypeIndex,
  nodeTypeOf,
  OperationError,
  outline,
  STARTERS,
} from "../src";

const empty: AutomationDraft = {
  name: "Test",
  trigger: { kind: "upload", fileType: "video" },
  nodes: [],
  edges: [],
};

const listedTypes = () =>
  actionTypesByGroup().flatMap((group) => group.types.map((nodeType) => nodeType.type));

describe("node registry", () => {
  it("describes every trigger, every catalog step, approval, clips, moments, chapters, motion, sound effects and export exactly once", () => {
    const names = NODE_TYPES.map((nodeType) => nodeType.type);
    expect(new Set(names).size).toBe(names.length);
    for (const kind of ["manual", "upload", "folder", "schedule", "webhook", "finished"]) {
      expect(getNodeType(`trigger:${kind}`)?.role).toBe("trigger");
    }
    for (const step of allSteps) expect(getNodeType(`step:${step.id}`)?.title).toBe(step.title);
    // The picture model is used by the dashboard itself, never added as a step.
    expect(listedTypes()).not.toContain("step:media-look");
    expect(savedKind("step:media-look")).toBeNull();
    expect(getNodeType("approval")?.takes).toBe("files");
    expect(getNodeType("clips")?.gives).toBe("files");
    expect(getNodeType("export")).toMatchObject({ takes: "files", gives: "files" });
    expect(getNodeType("automation")).toMatchObject({ takes: "files", gives: "files" });
    expect(getNodeType("moments")).toMatchObject({
      takes: "file",
      gives: "files",
      ask: ["platform"],
    });
    expect(getNodeType("chapters")).toMatchObject({ takes: "file", gives: "files" });
    expect(getNodeType("broll")).toMatchObject({
      title: "Add B-Roll",
      takes: "file",
      gives: "file",
    });
    expect(getNodeType("broll-plan")).toMatchObject({ title: "Plan B-Roll", group: "video" });
    expect(getNodeType("motion-plan")).toMatchObject({
      title: "Plan Motion Graphics",
      group: "video",
    });
    expect(savedKind("motion-plan")).toEqual({ kind: "motion-plan" });
    expect(getNodeType("motion")).toMatchObject({ takes: "file", gives: "files", group: "video" });
    expect(getNodeType("sound-effects")).toMatchObject({ takes: "file", gives: "files" });
    // The motion graphics render is only sent by those two, never listed as a step.
    expect(getNodeType("step:video-motion")).toBeDefined();
    expect(names).not.toContain("step:video-motion");
    expect(savedKind("step:video-motion")).toBeNull();
    expect(savedKind("motion")).toEqual({ kind: "motion" });
    expect(getNodeType("cleanup")).toMatchObject({
      title: "Clean Up Pauses And Retakes",
      takes: "file",
      gives: "files",
      group: "video",
    });
    expect(savedKind("cleanup")).toEqual({ kind: "cleanup" });
    expect(getNodeType("footage-check")).toMatchObject({
      title: "Check Footage",
      takes: "file",
      gives: "files",
      group: "video",
    });
    expect(savedKind("footage-check")).toEqual({ kind: "footage-check" });
    expect(getNodeType("subtitles")).toMatchObject({
      title: "Translate Subtitles",
      takes: "file",
      gives: "files",
      group: "media",
    });
    expect(savedKind("subtitles")).toEqual({ kind: "subtitles" });
    expect(savedKind("send")).toEqual({ kind: "send" });
    // The address is the person's to give; the agent asks for it.
    expect(missingSettingsOf(getNodeType("send")!, {})).toEqual(["url"]);
    // No language picked yet is a setting still to fill in.
    expect(missingSettingsOf(getNodeType("subtitles")!, { languages: [] })).toEqual(["languages"]);
    expect(missingSettingsOf(getNodeType("subtitles")!, { languages: ["es"] })).toEqual([]);
    // The toolkit's footage check is only sent by it, never listed as a step.
    expect(names).not.toContain("step:media-check");
    expect(names.length).toBe(6 + allSteps.length + 17);
  });

  it("gives every type a title, a description and an object schema for its settings", () => {
    for (const nodeType of NODE_TYPES) {
      expect(nodeType.title.length).toBeGreaterThanOrEqual(2);
      expect(nodeType.description.length).toBeGreaterThan(10);
      expect(nodeType.settings.type).toBe("object");
      if (nodeType.automatic) {
        expect(Object.keys(nodeType.settings.properties ?? {})).toContain(nodeType.automatic);
      }
    }
  });

  it("lists only steps that can be added, with no trigger among them", () => {
    const listed = actionTypesByGroup().flatMap((group) => group.types);
    expect(listed.every((nodeType) => nodeType.role === "action")).toBe(true);
    expect(listed.length).toBe(allSteps.length + 17);
  });

  it("knows the type of every node in every template", () => {
    for (const starter of STARTERS) {
      for (const node of starter.nodes) expect(nodeTypeOf(node), starter.id).toBeDefined();
    }
  });

  it("has a one-line-per-type index a model can read", () => {
    const lines = nodeTypeIndex().split("\n");
    expect(lines.length).toBe(NODE_TYPES.length);
    expect(lines.find((line) => line.startsWith("step:video-caption "))).toMatch(/takes file/);
  });
});

describe("operations", () => {
  const built = applyOperations(empty, [
    { op: "add", type: "step:video-caption", id: "captions" },
    { op: "add", type: "approval", after: "captions" },
  ]);

  it("adds steps left to right and connects each to the one it follows", () => {
    expect(built.nodes.map((node) => node.id)).toEqual(["captions", "approval_1"]);
    expect(built.edges).toEqual([
      { id: "captions>approval_1", source: "captions", target: "approval_1" },
    ]);
    expect(built.nodes[1].position.x - built.nodes[0].position.x).toBe(NODE_GAP);
    expect(graphProblem(built.nodes, built.edges)).toBeNull();
  });

  it("puts a step on a line between two others and moves the rest along", () => {
    const next = applyOperation(built, {
      op: "add",
      type: "clips",
      after: "captions",
      before: "approval_1",
    });
    expect(next.edges.map((edge) => edge.id).sort()).toEqual([
      "captions>clips_1",
      "clips_1>approval_1",
    ]);
    const x = Object.fromEntries(next.nodes.map((node) => [node.id, node.position.x]));
    expect(x.clips_1).toBe(NODE_GAP);
    expect(x.approval_1).toBe(2 * NODE_GAP);
    expect(next.nodes.find((node) => node.id === "clips_1")?.input).toEqual({
      platform: "Instagram Reels",
    });
  });

  it("puts a step in front of the first one", () => {
    const next = applyOperation(built, {
      op: "add",
      type: "step:media-download",
      before: "captions",
    });
    expect(next.edges.map((edge) => edge.id)).toContain("download_1>captions");
    expect(graphProblem(next.nodes, next.edges)).toBeNull();
  });

  it("joins the neighbours of a removed step", () => {
    const three = applyOperation(built, { op: "add", type: "clips", after: "approval_1" });
    const next = applyOperation(three, { op: "remove", ids: ["approval_1"] });
    expect(next.nodes.map((node) => node.id)).toEqual(["captions", "clips_1"]);
    expect(next.edges).toEqual([{ id: "captions>clips_1", source: "captions", target: "clips_1" }]);
  });

  it("sets, clears and refuses settings by the type's own schema", () => {
    const set = applyOperation(built, { op: "set", id: "captions", settings: { language: "en" } });
    expect(set.nodes[0].input).toEqual({ language: "en" });
    const cleared = applyOperation(set, {
      op: "set",
      id: "captions",
      settings: { language: null },
    });
    expect(cleared.nodes[0].input).toEqual({});
    expect(() =>
      applyOperation(built, { op: "set", id: "captions", settings: { nonsense: 1 } }),
    ).toThrow(/not a setting of Caption video/);
  });

  it("refuses a loop, an unknown step and an unknown type, and says which change failed", () => {
    expect(() =>
      applyOperation(built, { op: "connect", source: "approval_1", target: "captions" }),
    ).toThrow(/loop/);
    expect(() => applyOperation(built, { op: "remove", ids: ["nope"] })).toThrow(OperationError);
    expect(() => applyOperation(built, { op: "add", type: "trigger:upload" })).toThrow(
      /not a step that can be added/,
    );
    expect(() =>
      applyOperations(built, [{ op: "tidy" }, { op: "add", type: "step:nope" }]),
    ).toThrow(/^Change 2 \(add\)/);
  });

  it("leaves the draft it was given untouched", () => {
    const before = JSON.stringify(built);
    applyOperations(built, [
      { op: "add", type: "clips", before: "approval_1" },
      { op: "rename", id: "captions", label: "Subtitles" },
      { op: "tidy" },
    ]);
    expect(JSON.stringify(built)).toBe(before);
  });

  it("changes the start and refuses a schedule that is too frequent", () => {
    const next = applyOperation(built, {
      op: "trigger",
      trigger: { kind: "folder", prefix: "incoming/", fileType: "video" },
    });
    expect(next.trigger.kind).toBe("folder");
    expect(() =>
      applyOperation(built, {
        op: "trigger",
        trigger: { kind: "schedule", schedule: { mode: "interval", minutes: 1 } },
      }),
    ).toThrow(OperationError);
  });

  it("reports what a step still needs, on that step", () => {
    const logo = applyOperation(built, { op: "add", type: "step:recipe-logo", after: "captions" });
    const problems = draftProblems(logo);
    expect(problems).toHaveLength(1);
    expect(problems[0].nodeId).toBe("logo_1");
    expect(problems[0].message).toMatch(/needs your team's logo\. Add it in Settings/);
    expect(draftProblems(built)).toEqual([]);
  });

  it("stops asking once the team's brand supplies what a step needs", () => {
    const logo = applyOperation(built, { op: "add", type: "step:recipe-logo", after: "captions" });
    expect(draftProblems(logo, { logo: "upload:abc" })).toEqual([]);
    expect(outline(logo, { logo: "upload:abc" })).not.toMatch(/PROBLEM/);
  });

  it("writes the automation out in running order for a model to read", () => {
    const text = outline(
      applyOperation(built, { op: "add", type: "step:recipe-logo", after: "captions" }),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe('Automation "Test"');
    expect(lines[1]).toBe('Starts: trigger:upload {"fileType":"video"}');
    expect(lines[2]).toMatch(/^- captions \[step:video-caption\] from the start/);
    expect(text).toMatch(/- logo_1 \[step:recipe-logo\] from captions .*PROBLEM/);
  });

  it("can rebuild every template from an empty automation with operations alone", () => {
    for (const starter of STARTERS) {
      const rebuilt = applyOperations({ ...empty, name: starter.name }, [
        { op: "trigger", trigger: starter.trigger },
        ...starter.nodes.map((node) => ({
          op: "add" as const,
          type: nodeTypeOf(node)!.type,
          id: node.id,
          settings: node.input,
        })),
        ...starter.edges.map((edge) => ({
          op: "connect" as const,
          source: edge.source,
          target: edge.target,
        })),
      ]);
      expect(
        rebuilt.nodes.map((node) => node.id),
        starter.id,
      ).toEqual(starter.nodes.map((node) => node.id));
      expect(rebuilt.edges.length, starter.id).toBe(starter.edges.length);
      expect(graphProblem(rebuilt.nodes, rebuilt.edges), starter.id).toBeNull();
    }
  });
});

describe("team brand", () => {
  const logoStep = getNodeType("step:recipe-logo")!;

  it("counts a brand setting as missing only while Settings has nothing for it", () => {
    expect(logoStep.brand).toEqual({ logo_url: "logo" });
    expect(missingSettingsOf(logoStep, {})).toContain("logo_url");
    expect(missingBrandOf(logoStep, {}, {})).toEqual(["logo"]);
    expect(missingSettingsOf(logoStep, {}, { logo: "upload:abc" })).not.toContain("logo_url");
    expect(missingBrandOf(logoStep, {}, { logo: "upload:abc" })).toEqual([]);
  });

  it("fills blank brand settings and leaves a step's own choice alone", () => {
    const brand = { logo: "upload:abc" };
    expect(withBrand(logoStep, {}, brand).logo_url).toBe("upload:abc");
    expect(withBrand(logoStep, { logo_url: "" }, brand).logo_url).toBe("upload:abc");
    expect(withBrand(logoStep, { logo_url: "https://x.test/a.png" }, brand).logo_url).toBe(
      "https://x.test/a.png",
    );
    expect(withBrand(logoStep, {}, {})).toEqual({});
  });

  it("tells the agent to ask the person which platform clips are for", () => {
    expect(nodeTypeIndex()).toMatch(/^clips .*ask the person for its platform\)/m);
  });

  it("only asks for settings the step really has", () => {
    for (const nodeType of NODE_TYPES) {
      for (const key of nodeType.ask ?? []) {
        expect(Object.keys(nodeType.settings.properties ?? {}), nodeType.type).toContain(key);
      }
    }
  });

  it("tells the agent which steps take the brand from Settings", () => {
    expect(nodeTypeIndex()).toMatch(/step:recipe-logo .*takes the team's logo from Settings/);
  });

  it("keeps a lasting pointer to an upload, not a link that runs out", () => {
    expect(readUploadRef(uploadRef("k57abc_1"))).toBe("k57abc_1");
    expect(readUploadRef("https://x.test/a.png")).toBeNull();
    expect(readUploadRef(undefined)).toBeNull();
  });

  it("checks brand values in plain words", () => {
    expect(brandProblem("logo", "upload:abc")).toBeNull();
    expect(brandProblem("logo", "https://x.test/a.png")).toBeNull();
    expect(brandProblem("logo", "a.png")).toMatch(/uploads/);
    expect(brandProblem("color", "#FFCC00")).toBeNull();
    expect(brandProblem("color", "white")).toBeNull();
    expect(brandProblem("color", "#FC0")).toMatch(/colour/);
    expect(brandProblem("font", "Arial Black")).toBeNull();
    expect(brandProblem("font", "bad;font")).toMatch(/font name/);
  });
});

describe("file details", () => {
  const answer = {
    filesize: 52428800,
    duration: 412.6,
    duration_formatted: "00:06:52.60",
    format: "mov,mp4,m4a,3gp,3g2,mj2",
    overall_bitrate: 1016000,
    video_codec: "h264",
    width: 1920,
    height: 1080,
    fps: 29.97,
    audio_codec: "aac",
    audio_channels: 2,
    audio_sample_rate: 48000,
    has_video: true,
    has_audio: true,
  };

  it("keeps what the toolkit read and drops what it does not know", () => {
    expect(readFileDetails(answer)).toEqual({
      filesize: 52428800,
      duration: 412.6,
      format: "mov,mp4,m4a,3gp,3g2,mj2",
      bitrate: 1016000,
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      fps: 29.97,
      audioCodec: "aac",
      audioChannels: 2,
      audioSampleRate: 48000,
      hasVideo: true,
      hasAudio: true,
    });
    expect(readFileDetails({ duration: "long", video_codec: "unknown" })).toBeNull();
    expect(readFileDetails("ffprobe failed")).toBeNull();
    expect(readFileDetails({ width: 400, height: 400, format: "png_pipe" })).toMatchObject({
      hasVideo: true,
    });
  });

  it("writes the details on one line", () => {
    expect(describeFileDetails(readFileDetails(answer)!)).toBe(
      "6:53 · 1920×1080 · 29.97 fps · h264 / aac",
    );
    expect(
      describeFileDetails({ duration: 4, format: "mp3", audioCodec: "mp3", hasAudio: true }),
    ).toBe("0:04 · mp3");
    expect(
      describeFileDetails({ width: 400, height: 400, format: "png_pipe", videoCodec: "png" }),
    ).toBe("400×400");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("lays every file out in the same columns", () => {
    expect(fileDetailColumns(readFileDetails(answer)!)).toEqual({
      type: "Video",
      length: "6:53",
      picture: "1920×1080",
      frameRate: "29.97 fps",
      format: "h264 / aac",
    });
    expect(
      fileDetailColumns({ duration: 4, format: "mp3", audioCodec: "mp3", hasAudio: true }),
    ).toEqual({ type: "Audio", length: "0:04", picture: null, frameRate: null, format: "mp3" });
    expect(
      fileDetailColumns({
        width: 400,
        height: 400,
        format: "png_pipe",
        videoCodec: "png",
        fps: 25,
      }),
    ).toEqual({
      type: "Picture",
      length: null,
      picture: "400×400",
      frameRate: null,
      format: "png",
    });
  });

  it("lists everything that was read, in a fixed order", () => {
    expect(fileDetailRows(readFileDetails(answer)!)).toContainEqual([
      "Container",
      "mov, mp4, m4a, 3gp, 3g2, mj2",
    ]);
    expect(fileDetailRows(readFileDetails(answer)!, "Full Interview.MP4")).toEqual([
      ["Type", "Video"],
      ["Length", "6:53"],
      ["Picture size", "1920×1080"],
      ["Frame rate", "29.97 fps"],
      ["Video format", "h264"],
      ["Sound format", "aac"],
      ["Sound", "Stereo"],
      ["Sample rate", "48 kHz"],
      ["Container", "mp4"],
      ["Bitrate", "1.02 Mbps"],
    ]);
  });

  it("limits an upload trigger by length, and leaves out a file of unknown length", () => {
    expect(withinLength({}, null)).toBe(true);
    expect(withinLength({ maxSeconds: 60 }, { duration: 45 })).toBe(true);
    expect(withinLength({ maxSeconds: 60 }, { duration: 412.6 })).toBe(false);
    expect(withinLength({ minSeconds: 60 }, { duration: 45 })).toBe(false);
    expect(withinLength({ minSeconds: 30, maxSeconds: 60 }, { duration: 45 })).toBe(true);
    expect(withinLength({ maxSeconds: 60 }, null)).toBe(false);
    expect(withinLength({ maxSeconds: 60 }, { width: 400 })).toBe(false);
  });
});
