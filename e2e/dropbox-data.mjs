// What the Dropbox stand-in (e2e/dropbox-stand-in.mjs) and the browser tests agree on: the
// account, its folders and files, and the app secret notices are signed with. Plain
// data, so a test can import it without starting anything.

export const DROPBOX_PORT = 8773;
export const DROPBOX = `http://127.0.0.1:${DROPBOX_PORT}`;
export const DROPBOX_SECRET = "stand-in-dropbox-secret";
export const DROPBOX_ACCOUNT = {
  account_id: "dbid:stand-in",
  email: "editor@harbour.test",
  name: { display_name: "Harbour Editor" },
  // A Dropbox team account: team folders sit beside the member's own.
  root_info: { root_namespace_id: "900", home_namespace_id: "901" },
};

/** A file in Dropbox, the way a folder listing shows it. */
export function dropboxFile(path, size = 48_000_000, daysAgo = 0) {
  return {
    ".tag": "file",
    id: `id:${path}`,
    name: path.split("/").pop(),
    path_lower: path.toLowerCase(),
    path_display: path,
    server_modified: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    size,
    content_hash: `hash-${path}`,
    is_downloadable: true,
  };
}

export function dropboxFolder(path, shared = false) {
  return {
    ".tag": "folder",
    id: `id:${path}`,
    name: path.split("/").pop(),
    path_lower: path.toLowerCase(),
    path_display: path,
    ...(shared ? { sharing_info: { read_only: false } } : {}),
  };
}
