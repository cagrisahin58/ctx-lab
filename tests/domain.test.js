import test from "node:test";
import assert from "node:assert/strict";
import {
  appendCodexRunToWorkItem,
  appendSessionToWorkItem,
  appendDecisionToWorkItem,
  buildArchivedRecordContent,
  buildCodexRunMemoryRecord,
  buildContextPack,
  buildDailyBrief,
  buildDecisionFromSession,
  buildInboxSessionSummary,
  buildInboxSessionSummaryFromMarkdown,
  buildManualDecision,
  buildManualWorkItem,
  buildMemoryExportFiles,
  buildOnboardingChecklist,
  buildSessionClosePrompt,
  buildTimelineEvents,
  buildWorkItemFromSession,
  buildZipArchive,
  dismissTriageSuggestionContent,
  filterRecords,
  findWorkItemForSession,
  generateHandoffPrompt,
  getSection,
  parseFrontmatter,
  parseMemoryFile,
  parseRepoInput,
  isOnboardingComplete,
  replaceFrontmatter,
  resolveWorkContext,
  slugify,
  suggestWorkItemForSession,
  updateWorkItemNextActionContent,
  updateWorkItemStatusContent,
  upsertRecord,
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
- Oturum Akışı fikri tartışıldı.

## Kararlar
- GitHub kaynak gerçeklik olacak.

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
  const parsed = parseMemoryFile(work.path, work.content, "sha-work");
  assert.equal(work.path, "work_items/work_ctx-lab.md");
  assert.equal(parsed.repo, "cagrisahin58/ctx-lab");
  assert.deepEqual(parsed.tags, ["tasarim", "github"]);
  assert.match(work.content, /Yeni uygulama yönünü netleştirmek/);
});

test("manuel iş hattı içeriği üretir", () => {
  const work = buildManualWorkItem(
    {
      title: "AI Çalışma Hafızası v1",
      project: "ctx-lab",
      repo: "cagrisahin58/ctx-lab",
      branch: "main",
      objective: "Kanban üzerinden bağımsız iş hattı başlatmak.",
      current: "Tasarım netleşti.",
      next: "Formu panoya bağla.",
      risks: "Kapsam büyümesi."
    },
    new Date("2026-05-13T12:00:00.000Z")
  );
  const parsed = parseMemoryFile(work.path, work.content, "sha-work");

  assert.equal(work.id, "work_ai-calisma-hafizasi-v1");
  assert.equal(parsed.frontmatter.status, "active");
  assert.equal(parsed.frontmatter.repo, "cagrisahin58/ctx-lab");
  assert.equal(getSection(parsed.sections, "objective"), "Kanban üzerinden bağımsız iş hattı başlatmak.");
  assert.equal(getSection(parsed.sections, "next"), "Formu panoya bağla.");
});

test("decision içeriği üretir", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  const decision = buildDecisionFromSession(record);
  assert.ok(decision);
  assert.match(decision.content, /GitHub kaynak gerçeklik olacak/);
});

test("varsayılan boş karar metninden karar kaydı üretmez", () => {
  const summary = buildInboxSessionSummary(
    {
      id: "sess_no_decision",
      source: "codex",
      project: "ctx-lab",
      goal: "Kapanış özetini kaydet.",
      happened: "Karar alınmadan ilerleme kaydedildi.",
      next: "Sonraki işi planla."
    },
    new Date("2026-05-13T12:00:00.000Z")
  );
  const record = parseMemoryFile(summary.path, summary.content, "sha-summary");

  assert.equal(buildDecisionFromSession(record), null);
});

test("manuel karar kaydı üretir ve iş hattı kaynağını taşır", () => {
  const decision = buildManualDecision(
    {
      title: "Hafıza reposu kaynak olacak",
      project: "ctx-lab",
      workItemId: "work_ctx-lab",
      decision: "GitHub hafıza reposu kalıcı kaynak olarak kullanılacak.",
      rationale: "Claude ve Codex arasında taşınabilirlik gerekiyor.",
      impact: "Tüm handoff kayıtları repodan okunacak.",
      source: "Plan oturumu",
      tags: ["github", "karar"]
    },
    new Date("2026-05-13T12:00:00.000Z")
  );
  const parsed = parseMemoryFile(decision.path, decision.content, "sha-decision");

  assert.equal(decision.id, "dec_2026-05-13T12-00-00-000Z_hafiza-reposu-kaynak-olacak");
  assert.equal(parsed.frontmatter.source, "manual");
  assert.equal(parsed.frontmatter.source_work_item, "work_ctx-lab");
  assert.deepEqual(parsed.frontmatter.tags, ["github", "karar"]);
  assert.equal(getSection(parsed.sections, "decisions"), "GitHub hafıza reposu kalıcı kaynak olarak kullanılacak.");
  assert.equal(getSection(parsed.sections, "rationale"), "Claude ve Codex arasında taşınabilirlik gerekiyor.");
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
  assert.match(summary.content, /# Oturum Özeti/);
  assert.doesNotMatch(summary.content, /# Session Summary/);
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

test("iş hattı yaşam döngüsü ve arşiv önerilerini uyarır", () => {
  const session = parseMemoryFile(
    "inbox/lifecycle.md",
    sample.replace("id: sess_test", "id: sess_lifecycle"),
    "sha-session"
  );
  const done = parseMemoryFile(
    "work_items/done.md",
    buildWorkItemFromSession({ ...session, id: "sess_done_lifecycle", project: "done lifecycle" }).content
      .replace("status: active", "status: done")
      .replace(/updated_at: .+/, "updated_at: 2026-04-20T00:00:00.000Z"),
    "sha-done"
  );
  const stale = parseMemoryFile(
    "work_items/stale.md",
    buildWorkItemFromSession({ ...session, id: "sess_stale_lifecycle", project: "stale lifecycle" }).content
      .replace(/updated_at: .+/, "updated_at: 2026-04-01T00:00:00.000Z"),
    "sha-stale"
  );
  const recent = parseMemoryFile(
    "work_items/recent.md",
    buildWorkItemFromSession({ ...session, id: "sess_recent_lifecycle", project: "recent lifecycle" }).content
      .replace(/updated_at: .+/, "updated_at: 2026-05-10T00:00:00.000Z"),
    "sha-recent"
  );
  const warnings = validateMemoryRecords([done, stale, recent], new Date("2026-05-14T00:00:00.000Z"));

  assert.ok(warnings.some((warning) => warning.includes("done.md") && warning.includes("arşiv bekliyor")));
  assert.ok(warnings.some((warning) => warning.includes("stale.md") && warning.includes("güncellenmedi")));
  assert.equal(warnings.some((warning) => warning.includes("recent.md")), false);
});

test("onboarding checklist kurulum ilerlemesini somut sinyallerden hesaplar", () => {
  const empty = buildOnboardingChecklist();
  const cachedWithoutDiagnostics = buildOnboardingChecklist({
    config: { owner: "cagrisahin58", repo: "work-memory", branch: "main", token: "ghp_test" },
    cacheMeta: { syncedAt: "2026-05-14T10:00:00.000Z" },
    records: [parseMemoryFile("inbox/test.md", sample, "sha")]
  });
  const ready = buildOnboardingChecklist({
    config: { owner: "cagrisahin58", repo: "work-memory", branch: "main", token: "ghp_test" },
    diagnostics: { ok: true },
    runner: {
      health: { codex: { available: true } },
      projects: [{ id: "project_1" }],
      memory: { indexed: true }
    },
    briefReady: true
  });

  assert.equal(empty.find((item) => item.id === "memory_connection").done, false);
  assert.equal(cachedWithoutDiagnostics.find((item) => item.id === "repo_diagnostics").done, false);
  assert.equal(ready.find((item) => item.id === "codex_cli").done, true);
  assert.equal(ready.find((item) => item.id === "local_mirror").done, true);
  assert.equal(ready.find((item) => item.id === "local_mirror").label, "Yerel ayna ve indeks");
  assert.equal(isOnboardingComplete(empty), false);
  assert.equal(isOnboardingComplete(ready), true);
});

test("var olan iş hattına yeni session id ekler", () => {
  const record = parseMemoryFile("inbox/test.md", sample, "sha");
  const work = buildWorkItemFromSession(record);
  const workRecord = parseMemoryFile(work.path, work.content, "work-sha");
  const nextRecord = { ...record, id: "sess_followup" };
  const updated = appendSessionToWorkItem(workRecord, nextRecord);
  const parsed = parseFrontmatter(updated);

  assert.deepEqual(parsed.frontmatter.sessions, ["sess_test", "sess_followup"]);
  assert.match(parsed.body, /Devam Brifi/);
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
  assert.match(parsed.body, /# Oturum Özeti/);
  assert.doesNotMatch(parsed.body, /# Session Summary/);
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
  assert.match(prompt, /# Oturum Özeti/);
  assert.doesNotMatch(prompt, /# Session Summary/);
  assert.match(prompt, /## Sonraki Adımlar/);
});

test("iş hattından bağlı oturum ve kararlarla devam brifi üretir", () => {
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
title: GitHub hafıza reposu seçimi
project: ctx-lab
source_session: sess_test
created_at: 2026-05-13T12:00:00.000Z
---

## Karar
GitHub hafıza reposu kalıcı kaynak olacak.
`,
    "sha-decision"
  );
  const context = resolveWorkContext([work, session, decision], work);
  const pack = buildContextPack([work, session, decision], work, "codex");

  assert.equal(context.sessions.length, 1);
  assert.equal(context.decisions.length, 1);
  assert.match(pack, /Codex için ctx-lab devam brifi/);
  assert.match(pack, /sess_test/);
  assert.match(pack, /GitHub hafıza reposu kalıcı kaynak olacak/);
  assert.match(pack, /Çalışma kuralı/);
});

test("iş hattına doğrudan bağlı manuel karar devam brifi içinde çözülür", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const decision = parseMemoryFile(
    "decisions/dec_manual.md",
    buildManualDecision({
      id: "dec_manual",
      title: "Manuel karar",
      project: "ctx-lab",
      workItemId: "work_ctx-lab",
      decision: "Karar defteri bağımsız kullanılacak."
    }).content,
    "sha-decision"
  );
  const context = resolveWorkContext([work, decision], work);
  const pack = buildContextPack([work, decision], work, "codex");

  assert.equal(context.decisions.length, 1);
  assert.match(pack, /Karar defteri bağımsız kullanılacak/);
});

test("iş hattı olmadan source_work_item boş kararları yanlış bağlamaz", () => {
  const decision = parseMemoryFile(
    "decisions/dec_lonely.md",
    buildManualDecision({
      id: "dec_lonely",
      title: "Bağımsız karar",
      decision: "Bu karar bir iş hattına bağlı değil."
    }).content,
    "sha-decision"
  );
  const context = resolveWorkContext([decision], decision);

  assert.equal(context.workItem, null);
  assert.equal(context.decisions.length, 0);
});

test("açık işler ve işleme bekleyen oturumlar için günlük çalışma brifi üretir", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const blocked = parseMemoryFile(
    "work_items/work_blocked.md",
    buildWorkItemFromSession({ ...session, id: "sess_blocked", project: "blocked" }).content.replace("status: active", "status: blocked"),
    "sha-blocked"
  );
  const done = parseMemoryFile(
    "work_items/work_done.md",
    buildWorkItemFromSession({ ...session, id: "sess_done", project: "done" }).content.replace("status: active", "status: done"),
    "sha-done"
  );
  const brief = buildDailyBrief([session, work, blocked, done], "codex", new Date("2026-05-13T12:00:00.000Z"));

  assert.match(brief, /Codex için ctx-lab günlük çalışma brifi/);
  assert.match(brief, /Açık iş: 2/);
  assert.match(brief, /Engelli: 1/);
  assert.match(brief, /İşleme bekleyen oturum: 1/);
  assert.match(brief, /blocked çalışma hattı \[blocked\]/);
  assert.doesNotMatch(brief, /done çalışma hattı/);
});

test("memory export dosyaları manifest ve repo klasör düzenini koruyan zip üretir", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const exportBundle = buildMemoryExportFiles(
    [work, session],
    { owner: "cagrisahin58", repo: "ctx-lab", branch: "main" },
    new Date("2026-05-14T12:00:00.000Z")
  );

  assert.equal(exportBundle.filename, "ctx-lab-memory-cagrisahin58-ctx-lab-main-2026-05-14.zip");
  assert.equal(exportBundle.manifest.record_count, 2);
  assert.deepEqual(exportBundle.manifest.counts, { inbox: 1, work_items: 1 });
  assert.deepEqual(exportBundle.files.map((file) => file.path), [
    "ctx-lab-export-manifest.json",
    "inbox/test.md",
    "work_items/work_ctx-lab.md"
  ]);

  const zip = buildZipArchive(exportBundle.files);
  const zipText = new TextDecoder().decode(zip);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.match(zipText, /ctx-lab-export-manifest\.json/);
  assert.match(zipText, /work_items\/work_ctx-lab\.md/);
  assert.match(zipText, /Yeni uygulama yönünü netleştirmek/);
});

test("legacy kayıtlardan proje timeline olayları üretir", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content.replace("updated_at: ", "updated_at: 2026-05-14T12:10:00.000Z"),
    "sha-work"
  );
  const decision = parseMemoryFile(
    "decisions/dec_test.md",
    `---
id: dec_test
title: Timeline karari
project: ctx-lab
created_at: 2026-05-14T12:05:00.000Z
---

## Karar
Timeline event katmanı eklenecek.
`,
    "sha-decision"
  );
  const events = buildTimelineEvents([session, work, decision], [
    { id: "project_1", name: "ctx-lab", path: "C:\\repo", updatedAt: "2026-05-14T12:20:00.000Z" }
  ], [
    {
      id: "run_1",
      status: "succeeded",
      automationLevel: "commit_prepare",
      template: "continue_work",
      project: { name: "ctx-lab", repo: "cagrisahin58/ctx-lab" },
      createdAt: "2026-05-14T12:30:00.000Z",
      commitApplication: {
        status: "committed",
        commitSha: "abc123",
        appliedAt: "2026-05-14T12:31:00.000Z"
      }
    }
  ]);

  assert.deepEqual(events.slice(0, 2).map((event) => event.kind), ["commit_application", "codex_run"]);
  assert.ok(events.some((event) => event.kind === "project_registered"));
  assert.ok(events.some((event) => event.kind === "commit_application" && event.summary.includes("Commit SHA: abc123")));
  assert.ok(events.some((event) => event.kind === "session" && event.recordId === "sess_test"));
  assert.ok(events.some((event) => event.kind === "decision" && event.summary.includes("Timeline event")));
});

test("timeline GitHub senkron ve yerel ayna olaylarını gösterir", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha");
  const events = buildTimelineEvents([session], [], [], {
    cacheMeta: { syncedAt: "2026-05-14T08:05:00.000Z" },
    memory: {
      indexed: true,
      recordCount: 1,
      cloneDir: "C:\\ctx-lab\\memory\\git\\ctx-lab",
      lastIndexedAt: "2026-05-14T08:06:00.000Z"
    },
    project: "ctx-lab",
    repo: "cagrisahin58/ctx-lab",
    recordCount: 1
  });

  const github = events.find((event) => event.kind === "github_sync");
  const mirror = events.find((event) => event.kind === "mirror_sync");

  assert.equal(github.label, "GitHub senkron");
  assert.equal(github.title, "GitHub hafıza senkronizasyonu");
  assert.equal(github.summary, "1 kayıt yerel önbelleğe alındı.");
  assert.equal(mirror.label, "Yerel ayna");
  assert.equal(mirror.title, "Yerel hafıza aynası indekslendi");
  assert.equal(mirror.summary, "1 kayıt yerel aynadan okundu.");
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

test("iş hattı durumunu frontmatter içinde günceller", () => {
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
  assert.deepEqual(parsed.frontmatter.status_history, ["2026-05-13T12:00:00.000Z|active->blocked"]);
  assert.match(parsed.body, /Current State/);

  const blockedWork = parseMemoryFile(work.path, updated, "sha-blocked");
  const done = updateWorkItemStatusContent(blockedWork, "done", new Date("2026-05-13T12:30:00.000Z"));
  const doneWork = parseMemoryFile(work.path, done, "sha-done");
  const statusEvents = buildTimelineEvents([doneWork]).filter((event) => event.kind === "status_change");

  assert.deepEqual(doneWork.frontmatter.status_history, [
    "2026-05-13T12:00:00.000Z|active->blocked",
    "2026-05-13T12:30:00.000Z|blocked->done"
  ]);
  assert.equal(statusEvents[0].label, "Durum değişimi");
  assert.equal(statusEvents[0].title, "Engelli → Tamamlandı");
  assert.match(statusEvents[0].summary, /tamamlandı durumuna taşındı/);
  assert.throws(() => updateWorkItemStatusContent(work, "needs_triage"), /Geçersiz iş hattı durumu/);
});

test("iş hattı sonraki adım bölümünü günceller ve alias ile okur", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  assert.equal(getSection(work.sections, "next"), "- Parser yaz.");

  const updated = updateWorkItemNextActionContent(work, "- Devam brifini gerçek repo ile dene.", new Date("2026-05-13T12:00:00.000Z"));
  const parsed = parseMemoryFile(work.path, updated, "sha-updated");

  assert.equal(parsed.frontmatter.updated_at, "2026-05-13T12:00:00.000Z");
  assert.equal(getSection(parsed.sections, "next"), "- Devam brifini gerçek repo ile dene.");
  assert.match(updated, /## Current State/);
  assert.throws(() => updateWorkItemNextActionContent(work, " "), /Sonraki adım boş olamaz/);
});

test("aynı id veya path için kayıtları tekilleştirerek günceller", () => {
  const first = parseMemoryFile("inbox/test.md", sample, "sha-a");
  const updated = parseMemoryFile(
    "inbox/test.md",
    sample.replace("status: needs_triage", "status: linked"),
    "sha-b"
  );
  const other = parseMemoryFile(
    "decisions/dec_other.md",
    `---
id: dec_other
title: Başka karar
project: ctx-lab
created_at: 2026-05-13T12:00:00.000Z
---

## Karar
Başka kayıt.
`,
    "sha-c"
  );

  const records = upsertRecord([first, other], updated);
  assert.equal(records.length, 2);
  assert.equal(records[0].status, "linked");
  assert.equal(records[0].sha, "sha-b");
  assert.deepEqual(records.map((record) => record.id), ["sess_test", "dec_other"]);
});

test("session kaydına bağlı iş hattını bulur ve karar id'sini ekler", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const decision = buildDecisionFromSession(session);
  const found = findWorkItemForSession([work, session], session);
  const updated = appendDecisionToWorkItem(found, decision, new Date("2026-05-13T12:00:00.000Z"));
  const parsed = parseFrontmatter(updated);

  assert.equal(found.id, "work_ctx-lab");
  assert.deepEqual(parsed.frontmatter.decisions, [decision.id]);
  assert.equal(parsed.frontmatter.updated_at, "2026-05-13T12:00:00.000Z");
  assert.match(parsed.body, /Current State/);
});

test("inbox kaydı için mevcut iş hattı önerir ve reddi kaydeder", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const strongWork = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    replaceFrontmatter(buildWorkItemFromSession(session).content, { updated_at: "2026-05-14T12:00:00.000Z" }),
    "sha-work"
  );
  const weakWork = parseMemoryFile(
    "work_items/work_other.md",
    `---
id: work_other
title: Başka iş
project: başka
repo: cagrisahin58/other
status: active
updated_at: 2026-05-14T12:00:00.000Z
sessions:
decisions:
---

## Current State
Başka kayıt.
`,
    "sha-other"
  );

  const suggestion = suggestWorkItemForSession([weakWork, strongWork, session], session, {
    now: new Date("2026-05-14T12:05:00.000Z")
  });
  assert.equal(suggestion.workItem.id, "work_ctx-lab");
  assert.equal(suggestion.score, 12);
  assert.deepEqual(suggestion.reasons, ["proje eşleşmesi", "repo eşleşmesi", "2 ortak etiket", "son 7 günde güncellendi"]);

  const dismissed = parseMemoryFile(
    session.path,
    dismissTriageSuggestionContent(session, strongWork.id, new Date("2026-05-14T12:10:00.000Z")),
    "sha-dismissed"
  );

  assert.deepEqual(dismissed.frontmatter.triage_suggestion_dismissed, [strongWork.id]);
  assert.equal(
    suggestWorkItemForSession([strongWork, dismissed], dismissed, { now: new Date("2026-05-14T12:15:00.000Z") }),
    null
  );
  const linked = parseMemoryFile(
    session.path,
    replaceFrontmatter(session.raw, { status: "linked", linked_work_item: strongWork.id }),
    "sha-linked"
  );
  assert.equal(suggestWorkItemForSession([strongWork, linked], linked), null);
});

test("codex run sonucunu memory kaydina cevirir ve is hattina baglar", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const work = parseMemoryFile(
    "work_items/work_ctx-lab.md",
    buildWorkItemFromSession(session).content,
    "sha-work"
  );
  const run = {
    id: "run_2026-05-14T12-00-00-000Z_ctx-lab",
    status: "dry_run",
    automationLevel: "brief",
    template: "continue_work",
    sourceRecordId: work.id,
    sourceWorkItemId: work.id,
    project: { name: "ctx-lab", repo: "cagrisahin58/ctx-lab", branch: "main" },
    createdAt: "2026-05-14T12:00:00.000Z",
    updatedAt: "2026-05-14T12:00:00.000Z",
    logPath: "C:\\runs\\run.json",
    eventLogPath: "C:\\runs\\run.events.jsonl",
    gitAfter: {
      available: true,
      changedCount: 2,
      changedFiles: ["M src/main.js", "A tests/runner.test.js"]
    },
    commitReadiness: {
      ready: false,
      summary: "Commit/push için eksik kanıt var.",
      checks: [
        { id: "run", label: "Codex sonucu", ok: true, detail: "Codex komutu tamamlandı." },
        { id: "test", label: "Test sinyali", ok: false, detail: "Test çalıştırılmadı." }
      ]
    },
    commitDraft: {
      ready: false,
      message: "",
      body: [],
      changedFiles: ["M src/main.js", "A tests/runner.test.js"],
      pushAllowed: false,
      note: "Commit taslağı hazır değil; önce başarılı run, test sinyali ve Git değişikliği gerekir."
    },
    commitApplication: {
      status: "committed",
      commitSha: "commitsha123",
      appliedAt: "2026-05-14T12:03:00.000Z"
    },
    summary: "Deneme prompt kaydedildi."
  };
  const memory = buildCodexRunMemoryRecord(run, work, new Date("2026-05-14T12:01:00.000Z"));
  const parsedRun = parseMemoryFile(memory.path, memory.content, "sha-run");
  const updatedWork = appendCodexRunToWorkItem(work, parsedRun, new Date("2026-05-14T12:02:00.000Z"));
  const parsedWork = parseFrontmatter(updatedWork);
  const events = buildTimelineEvents([parsedRun], [], []);
  const runEvents = buildTimelineEvents([], [], [run]);

  assert.match(memory.path, /^handoffs\/2026-05-14T12-01-00-000Z-codex_run_run-2026-05-14t12-00-00-000z-ctx-lab\.md$/);
  assert.equal(parsedRun.frontmatter.kind, "codex_run");
  assert.equal(parsedRun.frontmatter.source_work_item, work.id);
  assert.equal(parsedRun.frontmatter.event_log_path, "C:\\runs\\run.events.jsonl");
  assert.match(parsedRun.raw, /Olay günlüğü: C:\\runs\\run\.events\.jsonl/);
  assert.match(parsedRun.raw, /## Değişiklik Özeti/);
  assert.match(parsedRun.raw, /- M src\/main\.js/);
  assert.match(parsedRun.raw, /## Commit Hazırlığı/);
  assert.match(parsedRun.raw, /Durum: Hazır değil/);
  assert.match(parsedRun.raw, /Eksik: Test sinyali - Test çalıştırılmadı\./);
  assert.match(parsedRun.raw, /## Commit Taslağı/);
  assert.match(parsedRun.raw, /Commit mesajı: hazır değil/);
  assert.match(parsedRun.raw, /Push durumu: Kapalı/);
  assert.match(parsedRun.raw, /## Commit Uygulaması/);
  assert.match(parsedRun.raw, /Commit SHA: commitsha123/);
  assert.deepEqual(parsedWork.frontmatter.codex_runs, [parsedRun.id]);
  assert.equal(events[0].kind, "codex_run");
  assert.equal(runEvents[0].kind, "commit_application");
  assert.equal(runEvents[0].label, "Commit uygulaması");
  assert.equal(runEvents[0].title, "Commit tamamlandı");
  assert.match(runEvents[0].summary, /commitsha123/);
});

test("arşiv içeriği status ve archived_at alanlarını günceller", () => {
  const session = parseMemoryFile("inbox/test.md", sample, "sha-session");
  const archived = buildArchivedRecordContent(session, new Date("2026-05-13T12:00:00.000Z"));
  const parsed = parseFrontmatter(archived);

  assert.equal(parsed.frontmatter.status, "archived");
  assert.equal(parsed.frontmatter.archived_at, "2026-05-13T12:00:00.000Z");
  assert.match(parsed.body, /Session Summary/);
});

test("bozuk frontmatter ve eksik zorunlu alanları uyarır", () => {
  const missingStatus = parseMemoryFile(
    "inbox/missing-status.md",
    sample.replace("status: needs_triage\n", ""),
    "sha-missing-status"
  );
  const missingId = parseMemoryFile(
    "work_items/missing-id.md",
    buildManualWorkItem({
      title: "Eksik id testi",
      project: "ctx-lab",
      repo: "cagrisahin58/ctx-lab",
      branch: "main",
      objective: "Eksik id uyarısını doğrula.",
      current: "Test kaydı.",
      next: "Validation panelinde göster."
    }).content.replace(/^id: .+\n/m, ""),
    "sha-missing-id"
  );
  const malformed = parseMemoryFile(
    "inbox/malformed.md",
    `---
id: sess_malformed
status needs_triage
---

# Oturum Özeti
`,
    "sha-malformed"
  );
  const unclosed = parseMemoryFile(
    "inbox/unclosed.md",
    `---
id: sess_unclosed
status: needs_triage

# Oturum Özeti
`,
    "sha-unclosed"
  );
  const malformedStatusHistory = parseMemoryFile(
    "work_items/malformed-status-history.md",
    buildManualWorkItem({
      title: "Durum geçmişi testi",
      project: "ctx-lab",
      repo: "cagrisahin58/ctx-lab",
      branch: "main",
      objective: "Durum geçmişi doğrulansın.",
      current: "Test kaydı.",
      next: "Validation panelinde göster."
    }).content.replace("status: active", "status: active\nstatus_history:\n  - bozuk-kayit"),
    "sha-history"
  );
  const warnings = validateMemoryRecords([missingStatus, missingId, malformed, unclosed, malformedStatusHistory]);

  assert.ok(warnings.some((warning) => warning.includes("missing-status.md") && warning.includes("status alan")));
  assert.ok(warnings.some((warning) => warning.includes("missing-id.md") && warning.includes("id alan")));
  assert.ok(warnings.some((warning) => warning.includes("malformed.md") && warning.includes("bozuk frontmatter")));
  assert.ok(warnings.some((warning) => warning.includes("unclosed.md") && warning.includes("kapanış")));
  assert.ok(warnings.some((warning) => warning.includes("malformed-status-history.md") && warning.includes("status_history")));
});
