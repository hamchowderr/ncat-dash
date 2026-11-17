"use client";

import {
  blankOf,
  isTimeSetting,
  missingInRows,
  settingShape,
  tidySetting,
  tidyTime,
  type SettingSchema,
} from "@ncat-dash/automation-core";
import { ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fieldLabel } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const UNSET = "__unset__";

/** What one row of a list is called, for its Add button. */
const ROW_WORDS: Record<string, string> = {
  cuts: "cut",
  splits: "clip",
  replace: "replacement",
  exclude_time_ranges: "time range",
  cookies: "cookie",
  filters: "filter",
  inputs: "input",
  outputs: "output",
  options: "option",
  global_options: "option",
  video_urls: "video",
  audio_urls: "audio file",
  formats: "format",
  languages: "language",
};

/** A plain hint for a list of time ranges, in place of the toolkit's own wording. */
export function structuredHint(schema: SettingSchema): string | null {
  const inner = schema.items?.properties ?? {};
  return Object.entries(inner).some(([field, fieldSchema]) => isTimeSetting(field, fieldSchema))
    ? "Type a time like 1:30, or 90 for ninety seconds."
    : null;
}

/** Saved data into what the editor holds: name and value pairs become rows. */
function toDraft(schema: SettingSchema, value: unknown): unknown {
  const shape = settingShape(schema);
  if (shape === "list")
    return Array.isArray(value) ? value.map((row) => toDraft(schema.items ?? {}, row)) : [];
  if (shape === "group") {
    const group = (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([name]) => group[name] !== undefined)
        .map(([name, inner]) => [name, toDraft(inner, group[name])]),
    );
  }
  if (shape === "pairs")
    return Object.entries((typeof value === "object" && value !== null ? value : {}) as object);
  return value === undefined || value === null ? "" : String(value);
}

function read(schema: SettingSchema, text: string): unknown {
  if (text.trim() === "") return toDraft(schema, undefined);
  try {
    return toDraft(schema, JSON.parse(text));
  } catch {
    return toDraft(schema, undefined);
  }
}

function write(schema: SettingSchema, draft: unknown): string {
  const tidy = tidySetting(schema, draft);
  return tidy === undefined ? "" : JSON.stringify(tidy);
}

/**
 * Edits a list or group setting as rows and fields. `value` is the saved setting as text (empty
 * when unset), which is what the rest of the step form holds; blank rows stay on screen while
 * someone is filling them in and are left out of what is saved.
 */
export function StructuredField({
  schema,
  name,
  value,
  onChange,
  id,
}: {
  schema: SettingSchema;
  name: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  const [draft, setDraft] = useState(() => read(schema, value));
  const [saved, setSaved] = useState(value);
  // The setting changed somewhere else (another step picked, a change undone): start again.
  if (value !== saved && value !== write(schema, draft)) {
    setSaved(value);
    setDraft(read(schema, value));
  }
  const missing = missingInRows(schema, draft);
  return (
    <div role="group" aria-label={fieldLabel(name)} className="flex flex-col gap-2">
      <Editor
        schema={schema}
        name={name}
        value={draft}
        id={id}
        onChange={(next) => {
          setDraft(next);
          const text = write(schema, next);
          setSaved(text);
          onChange(text);
        }}
      />
      {missing.length > 0 && (
        <p className="text-destructive text-xs">
          Every {ROW_WORDS[name] ?? "row"} needs{" "}
          {missing
            .map(
              (word) => `${/^[aeiou]/.test(word) ? "an" : "a"} ${fieldLabel(word).toLowerCase()}`,
            )
            .join(" and ")}
          .
        </p>
      )}
    </div>
  );
}

type EditorProps = {
  schema: SettingSchema;
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
};

function Editor(props: EditorProps) {
  const shape = settingShape(props.schema);
  if (shape === "list") return <ListEditor {...props} />;
  if (shape === "group") return <GroupEditor {...props} />;
  if (shape === "pairs") return <PairsEditor {...props} />;
  return <ValueEditor {...props} />;
}

/** A setting simple enough to sit beside others on one line. */
function isSimple(schema: SettingSchema): boolean {
  return !["list", "group", "pairs"].includes(settingShape(schema));
}

function RowButtons({
  index,
  word,
  onUp,
  onRemove,
}: {
  index: number;
  word: string;
  onUp?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      {onUp && index > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${word} ${index + 1} up`}
          onClick={onUp}
        >
          <ArrowUp />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${word} ${index + 1}`}
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  );
}

function ListEditor({ schema, name, value, onChange, id }: EditorProps) {
  const rows = Array.isArray(value) ? value : [];
  const item = schema.items ?? {};
  const word = ROW_WORDS[name] ?? "row";
  const inner = Object.entries(item.properties ?? {});
  // Rows of one or two simple settings, such as a start and an end, sit on one line each.
  const inline =
    settingShape(item) === "group" &&
    inner.length <= 2 &&
    inner.every(([, field]) => isSimple(field));
  const set = (index: number, next: unknown) =>
    onChange(rows.map((row, at) => (at === index ? next : row)));
  const remove = (index: number) => onChange(rows.filter((_, at) => at !== index));
  const up = (index: number) => {
    const next = [...rows];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {inline && rows.length > 0 && (
        <div className="text-muted-foreground flex gap-2 pr-14 text-xs">
          {inner.map(([field]) => (
            <span key={field} className="flex-1">
              {fieldLabel(field)}
            </span>
          ))}
        </div>
      )}
      {rows.map((row, index) =>
        inline ? (
          <div key={index} className="flex items-center gap-2">
            {inner.map(([field, fieldSchema]) => (
              <div key={field} className="min-w-0 flex-1">
                <ValueEditor
                  schema={fieldSchema}
                  name={field}
                  value={(row as Record<string, unknown>)[field]}
                  onChange={(next) => set(index, { ...(row as object), [field]: next })}
                  id={`${id}-${index}-${field}`}
                  label={`${fieldLabel(field)} of ${word} ${index + 1}`}
                />
              </div>
            ))}
            <div className="flex w-12 justify-end">
              <RowButtons
                index={index}
                word={word}
                onUp={() => up(index)}
                onRemove={() => remove(index)}
              />
            </div>
          </div>
        ) : isSimple(item) ? (
          <div key={index} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ValueEditor
                schema={item}
                name={name}
                value={row}
                onChange={(next) => set(index, next)}
                id={`${id}-${index}`}
                label={`${word} ${index + 1}`}
              />
            </div>
            <RowButtons
              index={index}
              word={word}
              onUp={() => up(index)}
              onRemove={() => remove(index)}
            />
          </div>
        ) : (
          <div key={index} className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium capitalize">
                {word} {index + 1}
              </span>
              <RowButtons
                index={index}
                word={word}
                onUp={() => up(index)}
                onRemove={() => remove(index)}
              />
            </div>
            <Editor
              schema={item}
              name={name}
              value={row}
              onChange={(next) => set(index, next)}
              id={`${id}-${index}`}
            />
          </div>
        ),
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, blankOf(item)])}
      >
        <Plus />
        Add {/^[aeiou]/.test(word) ? "an" : "a"} {word}
      </Button>
    </div>
  );
}

function GroupEditor({ schema, value, onChange, id }: EditorProps) {
  const group = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
      {Object.entries(schema.properties ?? {}).map(([field, fieldSchema]) => {
        const simple = isSimple(fieldSchema);
        const fieldId = `${id}-${field}`;
        return (
          <div key={field} className={cn("flex min-w-0 flex-col gap-1", !simple && "col-span-2")}>
            <label
              htmlFor={fieldId}
              className="text-muted-foreground truncate text-xs"
              title={fieldSchema.description}
            >
              {fieldLabel(field)}
            </label>
            <Editor
              schema={fieldSchema}
              name={field}
              value={group[field]}
              onChange={(next) => onChange({ ...group, [field]: next })}
              id={fieldId}
            />
          </div>
        );
      })}
    </div>
  );
}

function PairsEditor({ name, value, onChange }: EditorProps) {
  const rows = (Array.isArray(value) ? value : []) as [string, string][];
  const word = name.endsWith("headers") ? "header" : "pair";
  const set = (index: number, next: [string, string]) =>
    onChange(rows.map((row, at) => (at === index ? next : row)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([key, text], index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={key}
            placeholder="Name"
            aria-label={`Name of ${word} ${index + 1}`}
            onChange={(event) => set(index, [event.target.value, text])}
          />
          <Input
            value={text}
            placeholder="Value"
            aria-label={`Value of ${word} ${index + 1}`}
            onChange={(event) => set(index, [key, event.target.value])}
          />
          <RowButtons
            index={index}
            word={word}
            onRemove={() => onChange(rows.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, ["", ""]])}
      >
        <Plus />
        Add a {word}
      </Button>
    </div>
  );
}

function ValueEditor({
  schema,
  name,
  value,
  onChange,
  id,
  label,
}: EditorProps & { label?: string }) {
  const shape = settingShape(schema);
  const text = value === undefined || value === null ? "" : String(value);
  if (shape === "choice" || shape === "yesno") {
    return (
      <Select
        value={text === "" ? UNSET : text}
        onValueChange={(next) => onChange(next === UNSET ? "" : next)}
      >
        <SelectTrigger id={id} aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>
            {schema.default !== undefined ? `Default (${schema.default})` : "Default"}
          </SelectItem>
          {(shape === "yesno" ? ["true", "false"] : (schema.enum ?? [])).map((option) => (
            <SelectItem key={option} value={option}>
              {shape === "yesno" ? (option === "true" ? "Yes" : "No") : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const time = isTimeSetting(name, schema);
  const colour = shape === "text" && name.endsWith("_color");
  const input = (
    <Input
      id={id}
      aria-label={label}
      value={text}
      type={shape === "number" ? "number" : "text"}
      step={schema.type === "integer" ? 1 : "any"}
      inputMode={time ? "numeric" : undefined}
      placeholder={
        time
          ? "0:00"
          : colour
            ? "#FFFFFF"
            : schema.default !== undefined
              ? String(schema.default)
              : schema.format === "uri"
                ? "https://"
                : undefined
      }
      onChange={(event) => onChange(event.target.value)}
      onBlur={time ? (event) => onChange(tidyTime(event.target.value)) : undefined}
      className={time ? "tabular-nums" : undefined}
    />
  );
  if (!colour) return input;
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label={`Pick ${label ?? fieldLabel(name).toLowerCase()}`}
        value={/^#[0-9a-f]{6}$/i.test(text) ? text : "#ffffff"}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="border-input size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
      />
      {input}
    </div>
  );
}
