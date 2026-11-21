import { invoke } from "@tauri-apps/api/core";

import { startConnect, type Api } from "./connect";

const api: Api = {
  saved: () => invoke("saved_servers"),
  open: (address) => invoke("open_server", { address }),
  forget: (address) => invoke("forget_server", { address }),
};

startConnect(document.getElementById("app")!, api, {
  reopenLast: window.location.hash !== "#switch",
});
