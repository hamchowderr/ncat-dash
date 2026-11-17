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

export const pushed = vi.fn();
export const toastError = vi.fn();
export const toastInfo = vi.fn();
export const toastSuccess = vi.fn();
/** Who the presence hook says is in the room. */
export const present: { userId: string; online: boolean; lastDisconnected: number }[] = [];

export function resetConvex() {
  queries.clear();
  mutations.clear();
  pushed.mockReset();
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
  useMutation(mutation: FunctionReference<"mutation">) {
    return mutationOf(mutation);
  },
};

export const presenceReact = { default: () => present };
export const nextNavigation = {
  useRouter: () => ({ push: pushed }),
  usePathname: () => "/review",
};
export const sonner = { toast: { error: toastError, info: toastInfo, success: toastSuccess } };
