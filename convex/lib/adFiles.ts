/**
 * Ad files: the finished files of an automation that makes hook variants, length cuts or
 * shapes carry a code such as "h02_c01_15s_9x16". From it the files are sorted into one
 * folder per shape and listed in a CSV that an ads manager can work from.
 */

export interface AdCode {
  /** "h02": which opening take. */
  hook: string | null;
  /** "c01": which ending take. */
  ending: string | null;
  /** "15s". */
  length: string | null;
  /** "9x16". */
  shape: string | null;
  captioned: boolean;
  /** The parts that name the idea itself, which stay the same across lengths and shapes. */
  concept: string[];
}

export function readAdCode(label: string): AdCode {
  const code: AdCode = {
    hook: null,
    ending: null,
    length: null,
    shape: null,
    captioned: false,
    concept: [],
  };
  for (const part of label.split("_").filter(Boolean)) {
    if (/^h\d+$/.test(part)) {
      code.hook = part;
      code.concept.push(part);
    } else if (/^c\d+$/.test(part)) {
      code.ending = part;
      code.concept.push(part);
    } else if (/^\d+s$/.test(part)) code.length = part;
    else if (/^\d+x\d+$/.test(part)) code.shape = part;
    else if (part === "captioned") code.captioned = true;
    else code.concept.push(part);
  }
  return code;
}

/** The folder a shape's files go in, such as "9x16/"; "" for a file without a shape. */
export function shapeFolder(label: string | null | undefined): string {
  const shape = label ? readAdCode(label).shape : null;
  return shape ? `${shape}/` : "";
}

/** "Boots Ad!" gives "boots_ad". */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "ad"
  );
}

/** The file's name without its ending and without the code at its end. */
export function stemOf(name: string, label: string): string {
  const dot = name.lastIndexOf(".");
  const bare = dot > 0 ? name.slice(0, dot) : name;
  return bare.endsWith(` ${label}`) ? bare.slice(0, -label.length - 1) : bare;
}

/**
 * The folder a creator's ad files go in, such as "Jane Doe/"; "" without a creator. UGC
 * teams compare results creator by creator, so each one's files stay together.
 */
export function creatorFolder(creator: string | null | undefined): string {
  const name = (creator ?? "").replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim();
  return name && !/^\.+$/.test(name) ? `${name}/` : "";
}

/**
 * A cleaned recording's takes: "hook01".."hook09" go in hooks/ and "body" in body/, the
 * layout a creator-folders trigger reads to start UGC Ad Variants.
 */
export function takeFolder(label: string | null | undefined): string | null {
  if (!label) return null;
  if (/^hook0[1-9]$/.test(label)) return "hooks/";
  if (label === "body") return "body/";
  return null;
}

/**
 * Where a coded file goes inside the automation's folder: creator first, then shape, or
 * for a cleaned recording's takes, creator then hooks/ or body/.
 */
export function adFolder(label: string | null | undefined, creator: string | null | undefined) {
  if (!label) return "";
  return `${creatorFolder(creator)}${takeFolder(label) ?? shapeFolder(label)}`;
}

export interface AdFile {
  /** The file's name as kept, such as "Boots ad h02_c01_15s.mp4". */
  name: string;
  /** Where it was kept, inside the automation's folder, such as "9x16/". */
  folder: string;
  label: string;
  /** Who filmed it, when the automation names a creator. */
  creator?: string | null;
}

export const AD_FILES_NAME = "Ad files.csv";

const COLUMNS = [
  "file_name",
  "folder",
  "creative_id",
  "creator",
  "hook",
  "ending",
  "length",
  "shape",
  "captioned",
  "primary_text",
  "headline",
  // Left for the team, so winners can be grouped by what kind of ad they are: the script
  // (problem-solution, skeptic, case study…), the creator's role, the visual format and
  // the visual hook in the first seconds.
  "script_type",
  "creator_role",
  "visual_format",
  "visual_hook",
];

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One row per file. The creative ID names the idea (the video and its hook and ending), so
 * the 15 s and 30 s cuts and every shape of one pairing share it, which is how ads
 * managers group results. Primary text, headline and the kind of ad are left for the team.
 */
export function adFilesCsv(files: AdFile[]): string {
  const rows = files.map((file) => {
    const code = readAdCode(file.label);
    const creator = file.creator?.trim() ?? "";
    const creative = [
      slug(stemOf(file.name, file.label)),
      ...code.concept,
      ...(creator ? [slug(creator)] : []),
    ].join("_");
    return [
      file.name,
      file.folder,
      creative,
      creator,
      code.hook ?? "",
      code.ending ?? "",
      code.length ?? "",
      code.shape ? code.shape.replace("x", ":") : "",
      code.captioned ? "yes" : "no",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
  });
  return `${[COLUMNS, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
