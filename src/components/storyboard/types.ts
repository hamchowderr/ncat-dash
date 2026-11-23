import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type Board = NonNullable<FunctionReturnType<typeof api.storyboards.get>>;
export type Chapter = Board["chapters"][number];
export type Take = Chapter["takes"][number];
