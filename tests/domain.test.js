import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionFromSession,
  buildWorkItemFromSession,
  generateHandoffPrompt,
  getSection,
  parseFrontmatter,
  parseMemoryFile,
  parseRepoInput,
  replaceFrontmatter,
  slugify
} from "../src/domain.js";

const sample = `---
id: sess_test
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: needs_triage
tags: [tasarim, github]
---

# Session Summary

## Amaç
Yeni uygulama yönünü netleştirmek.

## Yapılanlar
- AI Inbox fikri tartışıldı.

## Kararlar
- GitHub source-of-truth olacak.

## Sonraki Adımlar
- Parser yaz.
`;

test("repo girdisini owner/repo biçimine çevirir", () => {
  assert.deepEqual(parseRepoInput("https://github.com/cagrisahin58/work-memory.git"), {
    owner: "cagrisahin58",
    repo: "work-memory"
  });
});

test("frontmatter ve gövdeyi ayırır", () => {
  const parsed = parseFrontmatter(sample);
  assert.equal(parsed.frontmatter.id, "sess_test");
  assert.deepEqual(parsed.frontmatter.tags, ["tasarim", "github"]);
  assert.match(parsed.body, /Session Summary/);
});

test("Türkçe section aliaslarını okur", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  assert.equal(record.id, "sess_test");
  assert.equal(record.type, "inbox");
  assert.equal(record.status, "needs_triage");
  assert.equal(getSection(record.sections, "goal"), "Yeni uygulama yönünü netleştirmek.");
});

test("work item içeriği üretir", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  const work = buildWorkItemFromSession(record);
  assert.equal(work.path, "work_items/work_ctx-lab.md");
  assert.match(work.content, /Yeni uygulama yönünü netleştirmek/);
});

test("decision içeriği üretir", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  const decision = buildDecisionFromSession(record);
  assert.ok(decision);
  assert.match(decision.content, /GitHub source-of-truth olacak/);
});

test("handoff prompt Türkçe ve kaynaklıdır", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  const prompt = generateHandoffPrompt(record, "codex");
  assert.match(prompt, /Codex için devam prompt'u/);
  assert.match(prompt, /Repo: cagrisahin58\/ctx-lab/);
});

test("frontmatter güncellerken gövdeyi korur", () => {
  const updated = replaceFrontmatter(sample, { status: "linked", linked_work_item: "work_ctx-lab" });
  const parsed = parseFrontmatter(updated);
  assert.equal(parsed.frontmatter.status, "linked");
  assert.equal(parsed.frontmatter.linked_work_item, "work_ctx-lab");
  assert.match(parsed.body, /Yapılanlar/);
});

test("slugify Türkçe karakterleri güvenli hale getirir", () => {
  assert.equal(slugify("Çalışma Hafızası / İyi"), "calisma-hafizasi-iyi");
});
