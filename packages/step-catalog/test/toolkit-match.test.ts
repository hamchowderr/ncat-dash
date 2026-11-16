import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { steps, userInputJsonSchema } from "../src";

/**
 * toolkit-schemas.json is the request schema of every NCA Toolkit route, read out of the
 * toolkit's own `@validate_payload(...)` decorators. The toolkit rejects unknown fields,
 * so a step that drifts from it fails on a real server even though it passes here.
 * Refresh the file from the toolkit's routes/ folder when the toolkit changes.
 */
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  anyOf?: Schema[];
};

const toolkit: Record<string, Schema> = JSON.parse(
  fs.readFileSync(new URL("./toolkit-schemas.json", import.meta.url), "utf8"),
);
const RUNNER = ["webhook_url", "id"];

function typesOf(schema: Schema): string[] {
  if (schema.anyOf) return schema.anyOf.flatMap(typesOf);
  const types = schema.type === undefined ? [] : [schema.type].flat();
  return types.map((type) => (type === "integer" ? "number" : type));
}

function differences(mine: Schema, theirs: Schema, path: string, top = false): string[] {
  const found: string[] = [];
  const a = typesOf(mine);
  const b = typesOf(theirs);
  if (a.length && b.length && !a.every((type) => b.includes(type))) {
    found.push(`${path}: type ${a.join("|")} is not the toolkit's ${b.join("|")}`);
  }
  if (theirs.enum && JSON.stringify(mine.enum) !== JSON.stringify(theirs.enum)) {
    found.push(`${path}: choices differ from the toolkit's`);
  }
  if (theirs.properties) {
    const skip = (key: string) => top && RUNNER.includes(key);
    const ours = Object.keys(mine.properties ?? {});
    const real = Object.keys(theirs.properties).filter((key) => !skip(key));
    for (const key of ours)
      if (!real.includes(key)) found.push(`${path}.${key}: not a toolkit field`);
    for (const key of real) if (!ours.includes(key)) found.push(`${path}.${key}: missing`);
    const required = (schema: Schema) => (schema.required ?? []).filter((key) => !skip(key)).sort();
    if (JSON.stringify(required(mine)) !== JSON.stringify(required(theirs))) {
      found.push(
        `${path}: required is [${required(mine)}], the toolkit's is [${required(theirs)}]`,
      );
    }
    for (const key of ours.filter((key) => real.includes(key))) {
      found.push(...differences(mine.properties![key], theirs.properties[key], `${path}.${key}`));
    }
  }
  if (theirs.items && mine.items) found.push(...differences(mine.items, theirs.items, `${path}[]`));
  return found;
}

describe("the catalog matches the toolkit", () => {
  for (const step of steps) {
    it(step.id, () => {
      const theirs = toolkit[step.endpoint];
      expect(theirs, `the toolkit has no route ${step.endpoint}`).toBeDefined();
      expect(differences(userInputJsonSchema(step) as Schema, theirs, step.id, true)).toEqual([]);
    });
  }
});
