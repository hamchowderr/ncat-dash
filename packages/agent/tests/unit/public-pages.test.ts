import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { hideWelcomePage, isServerPath } from '../../src/mastra/lib/public-pages';

/**
 * The signed-in agent server shows nothing outside /api, /health and its own routes
 * (lib/public-pages.ts): Mastra's welcome page listed its endpoints to anyone who found
 * the address. Its own routes (the chat history among them) must keep answering.
 */
describe('agent server pages', () => {
  const routes = [
    '/agent-controller/threads',
    '/agent-controller/threads/:id/messages',
    '/images/:id',
  ];
  const app = new Hono();
  const hide = hideWelcomePage(routes);
  app.use(hide.path, hide.handler as never);
  app.get('/health', (c) => c.json({ success: true }));
  app.get('/api/agents', (c) => c.json({ agents: [] }));
  app.get('/agent-controller/threads', (c) => c.json({ threads: [] }));
  app.get('/agent-controller/threads/:id/messages', (c) => c.json({ messages: [] }));
  app.get('/images/:id', (c) => c.text('picture'));
  app.post('/hook', (c) => c.text('posted'));
  app.get('*', (c) => c.html('<title>Mastra Server</title>'));

  it('answers the welcome page and any other page with a plain 404', async () => {
    for (const path of [
      '/',
      '/studio',
      '/agents',
      '/assets/index.js',
      '/agent-controller',
      '/agent-controller/threads/abc',
      '/images/a/b',
    ]) {
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

  it("keeps the server's own GET routes answering, so the chat history loads", async () => {
    expect((await app.request('/agent-controller/threads')).status).toBe(200);
    expect((await app.request('/agent-controller/threads/t-1/messages')).status).toBe(200);
    expect((await app.request('/images/abc123')).status).toBe(200);
  });

  it('knows which paths belong to the server', () => {
    expect(isServerPath('/api')).toBe(true);
    expect(isServerPath('/api/x')).toBe(true);
    expect(isServerPath('/apix')).toBe(false);
    expect(isServerPath('/')).toBe(false);
    expect(isServerPath('/agent-controller/threads', routes)).toBe(true);
    expect(isServerPath('/agent-controller/threads/x/messages', routes)).toBe(true);
    expect(isServerPath('/agent-controller/threadsx', routes)).toBe(false);
  });
});
