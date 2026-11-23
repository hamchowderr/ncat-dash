import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { hideWelcomePage, isServerPath } from '../../src/mastra/lib/public-pages';

/**
 * The signed-in agent server shows nothing outside /api and /health (lib/public-pages.ts):
 * Mastra's welcome page listed its endpoints to anyone who found the address.
 */
describe('agent server pages', () => {
  const app = new Hono();
  app.use(hideWelcomePage.path, hideWelcomePage.handler as never);
  app.get('/health', (c) => c.json({ success: true }));
  app.get('/api/agents', (c) => c.json({ agents: [] }));
  app.post('/hook', (c) => c.text('posted'));
  app.get('*', (c) => c.html('<title>Mastra Server</title>'));

  it('answers the welcome page and any other page with a plain 404', async () => {
    for (const path of ['/', '/studio', '/agents', '/assets/index.js']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).not.toContain('Mastra');
    }
  });

  it('leaves the API, the health check and posts alone', async () => {
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/api/agents')).status).toBe(200);
    expect((await app.request('/hook', { method: 'POST' })).status).toBe(200);
  });

  it('knows which paths belong to the server', () => {
    expect(isServerPath('/api')).toBe(true);
    expect(isServerPath('/api/x')).toBe(true);
    expect(isServerPath('/apix')).toBe(false);
    expect(isServerPath('/')).toBe(false);
  });
});
