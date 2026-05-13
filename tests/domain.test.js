import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionToWorkItem,
  buildContextPack,
  buildDecisionFromSession,
  buildInboxSessionSummary,
  buildInboxSessionSummaryFromMarkdown,
  buildSessionClosePrompt,
  buildWorkItemFromSession,
  filterRecords,
  generateHandoffPrompt,
  getSection,
  parseFrontmatter,
  parseMemoryFile,
  parseRepoInput,
  replaceFrontmatter,
  resolveWorkContext,
  slugify,
  updateWorkItemStatusContent,
  validateMemoryRecords
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

test("manuel oturum özeti benzersiz inbox yolu üretir", () => {
  const now = new Date("2026-05-13T12:34:56.789Z");
  const summary = buildInboxSessionSummary(
    {
      source: "codex",
      project: "ctx-lab",
      repo: "cagrisahin58/ctx-lab",
      branch: "main",
      tags: "ai-inbox, karar",
      goal: "Bağlam kaybını azaltmak.",
      happened: "- Yeni form tasarlandı.",
      decisions: "- GitHub kaynak olacak.",
      questions: "",
      next: "Repo kurulumunu doğrula.",
      evidence: "https://github.com/cagrisahin58/ctx-lab"
    },
    now
  );

  assert.equal(summary.id, "sess_2026-05-13T12-34-56-789Z_ctx-lab_codex");
  assert.equal(summary.path, "inbox/2026-05-13T12-34-56-789Z-ctx-lab-codex.md");
  assert.match(summary.content, /status: needs_triage/);
  assert.match(summary.content, /Bağlam kaybını azaltmak/);
});

test("memory kayıtlarındaki duplicate id ve durum sorunlarını uyarır", () => {
  const first = parseMemoryFile("inbox/a.md", sample, "sha-a");
  const second = parseMemoryFile(
    "work_items/b.md",
    sample.replace("status: needs_triage", "status: stale"),
    "sha-b"
  );
  const warnings = validateMemoryRecords([first, second]);

  assert.ok(warnings.some((warning) => warning.includes("duplicate id (sess_test)")));
  assert.ok(warnings.some((warning) => warning.includes("bilinmeyen durum (stale)")));
});

test("var olan iş kartına yeni session id ekler", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  const work = buildWorkItemFromSession(record);
  const workRecord = parseMemoryFile(work.path, work.content, "work-sha");
  const nextRecord = { ...record, id: "sess_followup" };
  const updated = appendSessionToWorkItem(workRecord, nextRecord);
  const parsed = parseFrontmatter(updated);

  assert.deepEqual(parsed.frontmatter.sessions, ["sess_test", "sess_followup"]);
  assert.match(parsed.body, /Best Handoff Prompt/);
});

test("AI tarafında üretilen markdown özetini normalize eder", () => {
  const raw = `---
source: claude
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: done
tags:
  - kapanis
---

# Session Summary

## Amaç
Markdown içe aktarma akışını denemek.
`;
  const summary = buildInboxSessionSummaryFromMarkdown(raw, {}, new Date("2026-05-13T10:00:00.000Z"));
  const parsed = parseFrontmatter(summary.content);

  assert.equal(summary.path, "inbox/2026-05-13T10-00-00-000Z-ctx-lab-claude.md");
  assert.equal(parsed.frontmatter.status, "needs_triage");
  assert.deepEqual(parsed.frontmatter.tags, ["kapanis"]);
  assert.match(parsed.body, /Markdown içe aktarma/);
});

test("oturum kapanış prompt'u ctx-lab formatını ister", () => {
  const prompt = buildSessionClosePrompt({
    source: "codex",
    project: "ctx-lab",
    repo: "cagrisahin58/ctx-lab",
    branch: "main"
  });

  assert.match(prompt, /ctx-lab AI çalışma hafızası/);
  assert.match(prompt, /project: ctx-lab/);
  assert.match(prompt, /## Sonraki Adımlar/);
});

test("iş kartından bağlı oturum ve kararlarla context pack üretir", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const decision = parseMemoryFile(
    "decisions/dec_test.md",
    `---
id: dec_test
title: GitHub memory repo seçimi
project: ctx-lab
source_session: sess_test
created_at: 2026-05-13T12:00:00.000Z
---

## Karar
GitHub memory repo kalıcı kaynak olacak.
`,
    "sha-decision"
  );
  const context = resolveWorkContext([work, session, decision], work);
  const pack = buildContextPack([work, session, decision], work, "codex");

  assert.equal(context.sessions.length, 1);
  assert.equal(context.decisions.length, 1);
  assert.match(pack, /Codex için ctx-lab context pack/);
  assert.match(pack, /sess_test/);
  assert.match(pack, /GitHub memory repo kalıcı kaynak olacak/);
  assert.match(pack, /Çalışma kuralı/);
});

test("kayıtları çok kelimeli arama metniyle süzer", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const decision = parseMemoryFile(
    "decisions/dec_other.md",
    `---
id: dec_other
title: Başka karar
project: baska-proje
created_at: 2026-05-13T12:00:00.000Z
---

## Karar
Farklı bir kayıt.
`,
    "sha-decision"
  );

  assert.deepEqual(filterRecords([session, decision], "ctx github").map((record) => record.id), ["sess_test"]);
  assert.equal(filterRecords([session, decision], "").length, 2);
});

test("iş kartı durumunu frontmatter içinde günceller", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const updated = updateWorkItemStatusContent(work, "blocked", new Date("2026-05-13T12:00:00.000Z"));
  const parsed = parseFrontmatter(updated);

  assert.equal(parsed.frontmatter.status, "blocked");
  assert.equal(parsed.frontmatter.updated_at, "2026-05-13T12:00:00.000Z");
  assert.match(parsed.body, /Current State/);
  assert.throws(() => updateWorkItemStatusContent(work, "needs_triage"), /Geçersiz iş kartı durumu/);
});
