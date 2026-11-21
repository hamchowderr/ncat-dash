import { invoke } from "@tauri-apps/api/core";

import { startConnect, type Api } from "./connect";

const api: Api = {
  saved: () => invoke("saved_kontifis"),
  open: (address) => invoke("open_kontifi", { address }),
  forget: (address) => invoke("forget_kontifi", { address }),
};

startConnect(document.getElementById("app")!, api, {
  reopenLast: window.location.hash !== "#switch",
});
