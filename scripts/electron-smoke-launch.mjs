import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const useLinuxCiSandboxBypass = process.platform === "linux" && process.env.CI;
const args = useLinuxCiSandboxBypass
  ? ["--no-sandbox", "--disable-gpu", ".", "--smoke"]
  : [".", "--smoke"];

const child = spawn(electronPath, args, {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Electron smoke sinyal ile kapandi: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Electron smoke baslatilamadi: ${error.message}`);
  process.exit(1);
});
