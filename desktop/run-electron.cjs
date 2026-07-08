"use strict";

const { spawn } = require("node:child_process");
const electronPath = require("electron");

const env = { ...process.env };
// Make sure Electron starts as the desktop app, not as plain Node.js.
delete env.ELECTRON_RUN_AS_NODE;

// Pass CLI args through so desktop:dev can send the Vite dev-server URL.
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
