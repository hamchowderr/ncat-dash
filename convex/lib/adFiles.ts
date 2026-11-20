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

export interface AdFile {
  /** The file's name as kept, such as "Boots ad h02_c01_15s.mp4". */
  name: string;
  /** Where it was kept, inside the automation's folder, such as "9x16/". */
  folder: string;
  label: string;
}

export const AD_FILES_NAME = "Ad files.csv";

const COLUMNS = [
  "file_name",
  "folder",
  "creative_id",
  "hook",
  "ending",
  "length",
  "shape",
  "captioned",
  "primary_text",
  "headline",
];

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One row per file. The creative ID names the idea (the video and its hook and ending), so
 * the 15 s and 30 s cuts and every shape of one pairing share it, which is how ads
 * managers group results. Primary text and headline are left for the team to write.
 */
export function adFilesCsv(files: AdFile[]): string {
  const rows = files.map((file) => {
    const code = readAdCode(file.label);
    const creative = [slug(stemOf(file.name, file.label)), ...code.concept].join("_");
    return [
      file.name,
      file.folder,
      creative,
      code.hook ?? "",
      code.ending ?? "",
      code.length ?? "",
      code.shape ? code.shape.replace("x", ":") : "",
      code.captioned ? "yes" : "no",
      "",
      "",
    ];
  });
  return `${[COLUMNS, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
