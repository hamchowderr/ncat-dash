import { describe, expect, test } from "vitest";

import {
  AGENT_CONNECTORS,
  FORK_REPO,
  RECOMMENDED_SETUP,
  TOOLKIT_IMAGE,
  toolkitAgentPrompt,
} from "./toolkit-agent-prompt";

describe("the prompt for a team's own AI agent", () => {
  const prompt = toolkitAgentPrompt("https://app.studio.example");

  test("covers installing, updating and replacing a toolkit, and asks before removing", () => {
    expect(prompt).toContain("No toolkit yet: install one.");
    expect(prompt).toContain("update it to the latest image and keep its settings");
    expect(prompt).toContain("replace it with this fork");
    expect(prompt).toContain("Ask me before you delete or stop anything.");
  });

  test("names the fork's own guides and the ready-built image, never a build on the server", () => {
    expect(prompt).toContain(`${FORK_REPO}/blob/main/AGENTS.md`);
    expect(prompt).toContain(`${FORK_REPO}/blob/main/docker-compose.md`);
    expect(prompt).toContain(`${FORK_REPO}/blob/main/docs/storage/storage.md`);
    expect(prompt).toContain(TOOLKIT_IMAGE);
    expect(prompt).toContain("Never build the image on the server");
  });

  test("sets up what ours runs on: Redis, R2 with CORS for this dashboard, Cloudflare", () => {
    expect(prompt).toContain("REDIS_URL");
    expect(prompt).toContain("S3_REGION=auto");
    expect(prompt).toContain("CORS on that bucket for https://app.studio.example");
    expect(prompt).toContain("expose the ETag header");
    expect(prompt).toContain("Cloudflare Tunnel");
  });

  test("checks the toolkit and its bucket, then hands back the address and key", () => {
    expect(prompt).toContain("/v1/toolkit/test");
    expect(prompt).toContain("curl -X POST");
    expect(prompt).toContain("/v1/storage/info");
    expect(prompt).toContain("under Settings, Toolkit");
  });

  test("still reads well before the page knows its address", () => {
    expect(toolkitAgentPrompt("")).toContain("this Takewon dashboard's address");
  });

  test("the recommended setup names Cloudflare for files and the address", () => {
    expect(RECOMMENDED_SETUP.map((item) => item.label)).toEqual([
      "A Linux server or an always-on computer",
      "The ready-built image and Redis",
      "Coolify or Docker Compose, with HTTPS",
      "Cloudflare R2 for files",
      "Your own address through Cloudflare",
    ]);
  });

  test("has the agent add the providers' own connectors, so the team only signs in and pays", () => {
    for (const connector of AGENT_CONNECTORS) {
      expect(prompt, connector.name).toContain(connector.url.replace("your", "my"));
    }
    expect(prompt).toContain("read, write and deploy");
    expect(prompt).toContain("buy one only after I say yes");
    expect(prompt).toContain("tell me exactly how to add it to the app you are running in");
    expect(AGENT_CONNECTORS.map((connector) => connector.name)).toEqual([
      "Cloudflare",
      "Coolify",
      "Hostinger",
    ]);
  });
});
