/**
 * The agent server is reached only by the dashboard, Convex and the chat apps, all
 * through /api (and /health for the container check). Mastra answers every other GET
 * with its welcome page, which lists the server's endpoints to anyone who finds the
 * address. On a signed-in server that page is replaced with a plain 404.
 */

type PageContext = {
  req: { method: string; path: string };
  text(body: string, status: 404): Response;
};

export function isServerPath(path: string): boolean {
  return path === '/health' || path === '/api' || path.startsWith('/api/');
}

export const hideWelcomePage = {
  path: '*',
  handler: async (c: PageContext, next: () => Promise<void>) => {
    if ((c.req.method === 'GET' || c.req.method === 'HEAD') && !isServerPath(c.req.path)) {
      return c.text('Not found', 404);
    }
    await next();
  },
};
