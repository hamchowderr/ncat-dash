/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

import schema from "./component/schema.js";

const modules = import.meta.glob(["./component/**/*.ts", "!./component/**/*.test.ts"]);

/**
 * Registers the component with a convex-test backend, for an app's own tests.
 * @param name The name it is installed under in the app's convex.config.ts.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "supportTickets",
) {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
