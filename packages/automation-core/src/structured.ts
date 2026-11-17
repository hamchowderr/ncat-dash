/**
 * Settings that are lists or groups (cuts, find-and-replace pairs, caption styling) are edited
 * as rows and fields, never as typed-in data. These helpers hold the parts that do not need a
 * screen: what kind of editor a setting gets, tidying a time someone typed, and dropping the
 * blanks before a value is saved.
 */

export type SettingSchema = {
  type?: string | string[];
  format?: string;
  enum?: string[];
  description?: string;
  default?: string | number | boolean;
  properties?: Record<string, SettingSchema>;
  items?: SettingSchema;
  required?: string[];
  minItems?: number;
  additionalProperties?: boolean | SettingSchema;
};

export type SettingShape =
  | "text"
  | "number"
  | "yesno"
  | "choice"
  /** A list of rows, each row a value or a small group. */
  | "list"
  /** A fixed group of named settings. */
  | "group"
  /** Free name and value pairs, such as request headers. */
  | "pairs";

function typeOf(schema: SettingSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== "null");
  return schema.type;
}

export function settingShape(schema: SettingSchema): SettingShape {
  if (schema.enum) return "choice";
  const type = typeOf(schema);
  if (type === "array") return "list";
  if (type === "object") return schema.properties ? "group" : "pairs";
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "yesno";
  return "text";
}

/** Whether a setting inside a list row is a point in time, from its name. */
export function isTimeSetting(name: string, schema: SettingSchema): boolean {
  return settingShape(schema) === "text" && ["start", "end"].includes(name);
}

/**
 * Tidies a time someone typed into the hh:mm:ss form the toolkit takes: "90" becomes
 * "00:01:30", "1:30" becomes "00:01:30", "1:02:03.5" becomes "01:02:03.5". Anything that is
 * not a time is returned as typed, so it can be corrected.
 */
export function tidyTime(typed: string): string {
  const text = typed.trim();
  if (text === "") return "";
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return text;
  const [whole, fraction] = text.split(".");
  const parts = whole!.split(":").map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  const two = (value: number) => String(value).padStart(2, "0");
  const tidy = `${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
  return fraction ? `${tidy}.${fraction}` : tidy;
}

/** An empty row for a list, or an empty group. */
export function blankOf(schema: SettingSchema): unknown {
  const shape = settingShape(schema);
  if (shape === "list") return [];
  if (shape === "pairs") return {};
  if (shape === "group") return {};
  return "";
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/**
 * What is saved for a setting: blanks dropped at every level, numbers and yes/no turned from
 * what the form holds into real values. Returns undefined when nothing is left.
 */
export function tidySetting(schema: SettingSchema, value: unknown): unknown {
  const shape = settingShape(schema);
  if (shape === "list") {
    if (!Array.isArray(value)) return undefined;
    const rows = value
      .map((row) => tidySetting(schema.items ?? {}, row))
      .filter((row) => !isBlank(row));
    return rows.length > 0 ? rows : undefined;
  }
  if (shape === "group") {
    if (typeof value !== "object" || value === null) return undefined;
    const group: Record<string, unknown> = {};
    for (const [name, inner] of Object.entries(schema.properties ?? {})) {
      const tidy = tidySetting(inner, (value as Record<string, unknown>)[name]);
      if (!isBlank(tidy)) group[name] = tidy;
    }
    return Object.keys(group).length > 0 ? group : undefined;
  }
  if (shape === "pairs") {
    // Kept as a list of [name, value] rows while editing, so a name can be typed freely.
    const rows = Array.isArray(value)
      ? (value as [string, string][])
      : Object.entries((value ?? {}) as Record<string, string>);
    const pairs = Object.fromEntries(
      rows.filter(([name]) => name.trim() !== "").map(([name, v]) => [name.trim(), v]),
    );
    return Object.keys(pairs).length > 0 ? pairs : undefined;
  }
  if (isBlank(value)) return undefined;
  if (shape === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (shape === "yesno") return value === true || value === "true";
  return typeof value === "string" ? value : String(value);
}

/** Which settings of a list row are still missing, by name. Empty rows are not counted. */
export function missingInRows(schema: SettingSchema, value: unknown): string[] {
  if (settingShape(schema) !== "list" || !Array.isArray(value)) return [];
  const item = schema.items ?? {};
  if (settingShape(item) !== "group") return [];
  const missing = new Set<string>();
  for (const row of value) {
    const tidy = tidySetting(item, row) as Record<string, unknown> | undefined;
    if (!tidy) continue;
    for (const name of item.required ?? []) if (isBlank(tidy[name])) missing.add(name);
  }
  return [...missing];
}
