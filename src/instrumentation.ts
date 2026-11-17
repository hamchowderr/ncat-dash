/**
 * Runs once when the web server starts. It tells the agent chat's proxy routes who is
 * asking: the signed-in user, so each person gets their own conversations, and never
 * someone else's.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureChatKitProxy } = await import("@/lib/mastra-proxy");
  const { agentUserFor } = await import("@/lib/agent-session");
  configureChatKitProxy({ getUserId: agentUserFor });
}
