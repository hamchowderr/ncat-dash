import path from 'node:path';
import { MASTRA_RESOURCE_ID_KEY, RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';
import {
  chatWorkspaceFor,
  getChatWorkspace,
  WORKSPACE_ROOT,
  workspaceRootFor,
  workspaceTeamOf,
} from '../../src/mastra/lib/workspace';
import { createWorkspaceRoutes } from '../../src/mastra/routes/workspace';
import { deps } from '../helpers/route-harness';

/**
 * One workspace per team (lib/workspace.ts): on a signed-in server a team's agent works
 * in its own folder, and a resource with no team gets none, so no team can read or
 * write another team's files.
 */
describe('workspace per team', () => {
  it('reads the team from the signed resource id', () => {
    expect(workspaceTeamOf('user_1~team_1')).toBe('team_1');
    expect(workspaceTeamOf('user_1')).toBeNull();
    expect(workspaceTeamOf('channel:slack:T1:C1')).toBeNull();
    expect(workspaceTeamOf('user_1~../other')).toBeNull();
    expect(workspaceTeamOf('user_1~a/b')).toBeNull();
    expect(workspaceTeamOf(undefined)).toBeNull();
  });

  it('gives each team its own folder when signed in, and none without a team', () => {
    const opts = { root: '/srv/ws', signedIn: true };
    expect(workspaceRootFor('u~team_a', opts)).toBe(path.join('/srv/ws', 'teams', 'team_a'));
    expect(workspaceRootFor('u~team_b', opts)).toBe(path.join('/srv/ws', 'teams', 'team_b'));
    expect(workspaceRootFor('u', opts)).toBeNull();
    expect(workspaceRootFor('channel:x', opts)).toBeNull();
    expect(workspaceRootFor(undefined, opts)).toBeNull();
  });

  it('keeps the one shared folder without sign-in', () => {
    expect(workspaceRootFor(undefined, { root: '/srv/ws', signedIn: false })).toBe('/srv/ws');
  });

  it('resolves a request to its own workspace', () => {
    // Tests run without MASTRA_JWT_SECRET: one shared user.
    expect(chatWorkspaceFor(new RequestContext())).toBe(getChatWorkspace());
    expect(WORKSPACE_ROOT).toBeTruthy();
  });

  it('the Files panel reads only the requesting team’s folder', async () => {
    const roots: (string | undefined)[] = [];
    const routes = createWorkspaceRoutes(
      deps({
        workspace: {
          root: '/srv/ws',
          rootFor: (id) => workspaceRootFor(id, { root: '/srv/ws', signedIn: true }),
          readTree: (root) => {
            roots.push(root);
            return Promise.resolve([]);
          },
          readFile: (_p, root) => {
            roots.push(root);
            return Promise.resolve(null);
          },
        },
      }),
    );
    const files = routes.find((r) => r.path === '/workspace/files')!;
    const file = routes.find((r) => r.path === '/workspace/file')!;
    const call = async (route: typeof files, resourceId: string | undefined, query = {}) => {
      let out: { body: unknown; status: number } = { body: null, status: 200 };
      const ctx = new RequestContext();
      if (resourceId) ctx.set(MASTRA_RESOURCE_ID_KEY, resourceId);
      const c = {
        get: (k: string) => (k === 'requestContext' ? ctx : undefined),
        req: { query: (k: string) => (query as Record<string, string>)[k], param: () => undefined },
        json: (body: unknown, status = 200) => {
          out = { body, status };
          return out;
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: minimal Hono context
      await (route as any).handler(c);
      return out;
    };

    await call(files, 'u~team_a');
    expect(roots).toEqual([path.join('/srv/ws', 'teams', 'team_a')]);

    const none = await call(files, 'u');
    expect(none.body).toEqual({ root: '', tree: [] });

    const blocked = await call(file, 'channel:x', { path: 'a.txt' });
    expect(blocked.status).toBe(404);
    expect(roots).toHaveLength(1);
  });
});
