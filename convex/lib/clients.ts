/**
 * Where a client's finished files go in the team's folder: the folder the team picked for
 * it, or Clients/<name>/. Always ends in "/".
 */
export function deliveryFolderOf(client: { name: string; deliveryFolder?: string }): string {
  const picked = client.deliveryFolder?.trim().replace(/^\/+|\/+$/g, "");
  if (picked) return `${picked}/`;
  const name = client.name.trim().replace(/[/\\]/g, "-") || "Client";
  return `Clients/${name}/`;
}
