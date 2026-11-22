import { invoke } from "@tauri-apps/api/core";

import { startConnect, type Api } from "./connect";
import { startRun, type RunApi } from "./run";

const api: Api = {
  saved: () => invoke("saved_servers"),
  open: (address) => invoke("open_server", { address }),
  forget: (address) => invoke("forget_server", { address }),
};

const runApi: RunApi = {
  check: () => invoke("check_machine"),
  saved: () => invoke("stack_saved"),
  save: (settings) => invoke("save_stack", { settings }),
  step: (step) => invoke("run_stack_step", { step }),
  open: api.open,
};

const root = document.getElementById("app")!;

function connect(reopenLast: boolean) {
  void startConnect(root, api, { reopenLast, onRun: run });
}

function run() {
  void startRun(root, runApi, { back: () => connect(false) });
}

connect(window.location.hash !== "#switch");
