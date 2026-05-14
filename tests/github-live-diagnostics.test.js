import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveDiagnosticsConfigFromEnv,
  formatDiagnosticsResult,
  formatSkipMessage,
  parseRepoInput
} from "../scripts/github-live-diagnostics.mjs";

test("canli GitHub tani repo girdilerini normalize eder", () => {
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

test("canli GitHub tani eksik token veya repo varsa ag cagrisina hazirlanmaz", () => {
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
  assert.deepEqual(invalid.missing, ["gecerli owner/repo veya GitHub URL"]);
});

test("canli GitHub tani ciktilari token degerini sizdirmez", () => {
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
    directories: [{ label: "inbox/", ok: false, message: "inbox/ klasoru bulunamadi" }],
    writeAccess: { label: "Yazma testi", ok: true, detail: { path: "archive/.ctxlab-write-test" } }
  }, config.config);

  assert.match(formatted, /BASARISIZ/);
  assert.match(formatted, /cagrisahin58\/work-memory#main/);
  assert.match(formatted, /inbox\/ klasoru bulunamadi/);
  assert.doesNotMatch(formatted, /secret-token/);
});
