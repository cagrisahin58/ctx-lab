import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveDiagnosticsConfigFromEnv,
  formatDiagnosticsResult,
  formatSkipMessage,
  parseRepoInput
} from "../scripts/github-live-diagnostics.mjs";

test("canlı GitHub tanı repo girdilerini normalize eder", () => {
  assert.deepEqual(parseRepoInput("cagrisahin58/work-memory"), {
    owner: "cagrisahin58",
    repo: "work-memory"
  });
  assert.deepEqual(parseRepoInput("https://github.com/cagrisahin58/work-memory.git"), {
    owner: "cagrisahin58",
    repo: "work-memory"
  });
  assert.deepEqual(parseRepoInput("git@github.com:cagrisahin58/work-memory.git"), {
    owner: "cagrisahin58",
    repo: "work-memory"
  });
  assert.equal(parseRepoInput("not-a-repo"), null);
});

test("canlı GitHub tanı eksik token veya repo varsa ağ çağrısına hazırlanmaz", () => {
  const missing = buildLiveDiagnosticsConfigFromEnv({});
  assert.equal(missing.ok, false);
  assert.equal(missing.config, null);
  assert.deepEqual(missing.missing, ["CTX_LAB_GITHUB_REPO", "CTX_LAB_GITHUB_TOKEN"]);

  const invalid = buildLiveDiagnosticsConfigFromEnv({
    CTX_LAB_GITHUB_REPO: "not-a-repo",
    CTX_LAB_GITHUB_TOKEN: "secret-token"
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.config, null);
  assert.deepEqual(invalid.missing, ["geçerli owner/repo veya GitHub URL"]);
});

test("canlı GitHub tanı çıktıları token değerini sızdırmaz", () => {
  const config = buildLiveDiagnosticsConfigFromEnv({
    CTX_LAB_GITHUB_REPO: "cagrisahin58/work-memory",
    CTX_LAB_GITHUB_BRANCH: "main",
    CTX_LAB_GITHUB_TOKEN: "secret-token"
  });
  assert.equal(config.ok, true);
  assert.equal(config.config.token, "secret-token");

  const skip = formatSkipMessage(["CTX_LAB_GITHUB_TOKEN"]);
  assert.doesNotMatch(skip, /secret-token/);

  const formatted = formatDiagnosticsResult({
    ok: false,
    repo: { label: "Repo erisimi", ok: true, detail: { private: true, defaultBranch: "main", writeHint: true } },
    branch: { label: "Dal: main", ok: true, detail: { name: "main" } },
    configFile: { label: "config.yaml", ok: true, detail: { sha: "1234567890abcdef" } },
    directories: [{ label: "inbox/", ok: false, message: "inbox/ klasörü bulunamadı" }],
    writeAccess: { label: "Yazma testi", ok: true, detail: { path: "archive/.ctxlab-write-test" } }
  }, config.config);

  assert.match(formatted, /BAŞARISIZ/);
  assert.match(formatted, /cagrisahin58\/work-memory#main/);
  assert.match(formatted, /inbox\/ klasörü bulunamadı/);
  assert.doesNotMatch(formatted, /secret-token/);
});
