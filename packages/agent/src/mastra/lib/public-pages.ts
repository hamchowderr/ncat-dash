/**
 * The agent server is reached only by the dashboard, Convex and the chat apps: through
 * /api, /health (the container check) and the server's own routes (the chat history,
 * the agent's pictures and the rest of `apiRoutes`, which Mastra serves at their own
 * paths, outside /api). Mastra answers every other GET with its welcome page, which lists
 * the server's endpoints to anyone who finds the address. On a signed-in server that page
 * is replaced with a plain 404.
 */

type PageContext = {
  req: { method: string; path: string };
  text(body: string, status: 404): Response;
};

/** A route path like `/agent-controller/threads/:id` as a pattern matching its requests. */
function routePattern(path: string): RegExp {
  const parts = path.split('/').map((part) =>
    part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  return new RegExp(`^${parts.join('/')}/?$`);
}

/**
 * Whether a GET to `path` is one the server answers: /health, anything under /api, or one
 * of the server's own routes (`routes`, the paths of its `apiRoutes`).
 */
export function isServerPath(path: string, routes: readonly string[] = []): boolean {
  if (path === '/health' || path === '/api' || path.startsWith('/api/')) return true;
  return routes.some((route) => routePattern(route).test(path));
}

/**
 * The middleware that hides the welcome page. It is given the server's own route paths,
 * so the chat history and every other GET route of ours keeps answering (they 404'd when
 * only /api was let through).
 */
export function hideWelcomePage(routes: readonly string[]) {
  const patterns = routes.map(routePattern);
  return {
    path: '*',
    handler: async (c: PageContext, next: () => Promise<void>) => {
      const { method, path } = c.req;
      if (
        (method === 'GET' || method === 'HEAD') &&
        !isServerPath(path) &&
        !patterns.some((p) => p.test(path))
      ) {
        return c.text('Not found', 404);
      }
      await next();
    },
  };
}
