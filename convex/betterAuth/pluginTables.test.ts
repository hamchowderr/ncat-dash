import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAuthTables } from "better-auth/db";
import { expect, test } from "vitest";
import { createAuthOptions } from "../auth";
import { pluginTables } from "./pluginTables";

/** Only what survives JSON: the parts the adapter reads (names, unique flags, indexes). */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the adapter's copy of the plugin tables matches the real auth options", () => {
  const options = createAuthOptions({} as never);
  const real = (options.plugins ?? []).map((plugin) => ({ id: plugin.id, schema: plugin.schema }));
  if (process.env.UPDATE_PLUGIN_TABLES) {
    const path = join(__dirname, "pluginTables.ts");
    const header = readFileSync(path, "utf8").split("export const")[0];
    writeFileSync(path, `${header}export const pluginTables = ${JSON.stringify(plain(real), null, 2)};\n`);
  }
  expect(plain(pluginTables)).toEqual(plain(real));
  expect(plain(getAuthTables({ plugins: pluginTables } as never))).toEqual(
    plain(getAuthTables(options)),
  );
});
