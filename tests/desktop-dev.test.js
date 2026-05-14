import test from "node:test";
import assert from "node:assert/strict";
import { buildNpmInvocation } from "../scripts/desktop-dev.mjs";

test("desktop dev npm komutunu npm cli ile dogrudan node uzerinden kurar", () => {
  const [command, args] = buildNpmInvocation(["run", "dev"], {
    npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    npm_node_execpath: "C:\\Program Files\\nodejs\\node.exe"
  }, "win32");

  assert.equal(command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(args, [
    "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    "run",
    "dev"
  ]);
});

test("desktop dev npm cli env yoksa Windows cmd fallback kullanir", () => {
  const [command, args] = buildNpmInvocation(["run", "dev", "--", "--port", "5175"], {}, "win32");

  assert.equal(command, "cmd.exe");
  assert.deepEqual(args, ["/d", "/c", "npm.cmd run dev -- --port 5175"]);
});

test("desktop dev Windows disinda npm komutunu dogrudan kullanir", () => {
  const [command, args] = buildNpmInvocation(["run", "dev"], {}, "linux");

  assert.equal(command, "npm");
  assert.deepEqual(args, ["run", "dev"]);
});
