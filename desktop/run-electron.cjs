"use strict";

const { spawn } = require("node:child_process");
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, process.argv.slice(2), {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
