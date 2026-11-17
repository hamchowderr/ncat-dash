import { type FunctionReference, getFunctionName } from "convex/server";
import { vi } from "vitest";

// Stand-ins for the Convex hooks, so a screen can be rendered with chosen data and its
// calls to the backend checked. What the backend itself does is tested in convex/*.test.ts.

type Answer = unknown | ((args: Record<string, unknown>) => unknown);

const queries = new Map<string, Answer>();
const mutations = new Map<string, ReturnType<typeof vi.fn>>();

/** Sets what a query returns: a value, or a function of its arguments. */
export function answerQuery(query: FunctionReference<"query">, answer: Answer) {
  queries.set(getFunctionName(query), answer);
}

/** The stand-in behind a mutation, to check how it was called or make it fail. */
export function mutationOf(mutation: FunctionReference<"mutation">) {
  const name = getFunctionName(mutation);
  let mock = mutations.get(name);
  if (!mock) {
    mock = vi.fn(async () => null);
    mutations.set(name, mock);
  }
  return mock;
}

/** The stand-in behind an action, to check how it was called or set what it gives back. */
export function actionOf(action: FunctionReference<"action">) {
  return mutationOf(action as unknown as FunctionReference<"mutation">);
}

export const pushed = vi.fn();
export const replaced = vi.fn();
/** The stand-in behind "load more" on a paginated query. */
export const loadMore = vi.fn();
export const toastError = vi.fn();
export const toastInfo = vi.fn();
export const toastSuccess = vi.fn();
/** Who the presence hook says is in the room. */
export const present: {
  userId: string;
  online: boolean;
  lastDisconnected: number;
  data?: unknown;
}[] = [];

export function resetConvex() {
  queries.clear();
  mutations.clear();
  pushed.mockReset();
  replaced.mockReset();
  loadMore.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
  toastSuccess.mockReset();
  present.length = 0;
}

export const convexReact = {
  useQuery(query: FunctionReference<"query">, args: Record<string, unknown> | "skip") {
    if (args === "skip") return undefined;
    const answer = queries.get(getFunctionName(query));
    return typeof answer === "function" ? answer(args) : answer;
  },
  /**
   * A paginated query answers with its rows, or with `{ results, status }` to show more
   * pages waiting. Its arguments are given without `paginationOpts`.
   */
  usePaginatedQuery(query: FunctionReference<"query">, args: Record<string, unknown> | "skip") {
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore };
    const answer = queries.get(getFunctionName(query));
    const rows = typeof answer === "function" ? answer(args) : answer;
    if (rows === undefined) return { results: [], status: "LoadingFirstPage", loadMore };
    if (Array.isArray(rows)) return { results: rows, status: "Exhausted", loadMore };
    return { ...(rows as object), loadMore };
  },
  useMutation(mutation: FunctionReference<"mutation">) {
    return mutationOf(mutation);
  },
  useAction(action: FunctionReference<"action">) {
    return actionOf(action);
  },
};

export const presenceReact = { default: () => present };
export const nextNavigation = {
  useRouter: () => ({ push: pushed, replace: replaced }),
  usePathname: () => "/review",
};
export const sonner = { toast: { error: toastError, info: toastInfo, success: toastSuccess } };
