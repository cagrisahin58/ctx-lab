import "./styles.css";
import {
  appendDecisionToWorkItem,
  appendSessionToWorkItem,
  buildArchivedRecordContent,
  buildInboxSessionSummary,
  buildInboxSessionSummaryFromMarkdown,
  buildManualDecision,
  buildManualWorkItem,
  buildOnboardingChecklist,
  buildDecisionFromSession,
  buildContextPack,
  buildDailyBrief,
  buildSessionClosePrompt,
  buildTimelineEvents,
  buildWorkItemFromSession,
  filterRecords,
  findWorkItemForSession,
  getSection,
  groupByStatus,
  parseRepoInput,
  isOnboardingComplete,
  parseMemoryFile,
  replaceFrontmatter,
  updateWorkItemNextActionContent,
  updateWorkItemStatusContent,
  upsertRecord,
  WORK_STATUSES,
  validateMemoryRecords
} from "./domain.js";
import { deleteFile, diagnoseMemoryRepo, ensureMemoryRepo, loadMemoryRepo, putFile } from "./github.js";
import { demoRecords } from "./fixtures.js";
import {
  fetchRunnerHealth,
  fetchRunnerProjects,
  fetchRunnerRuns,
  fetchMemoryMirrorStatus,
  registerRunnerProject,
  selectRunnerProjectDirectory,
  syncMemoryMirror,
  startRunnerCodexRun
} from "./runner-client.js";
import { loadAppConfig, loadRecordCache, saveAppConfig, saveRecordCache } from "./storage.js";

const app = document.querySelector("#app");
const initialConfig = loadAppConfig();
const initialCache = loadRecordCache(initialConfig);
const needsInitialOnboarding = !initialConfig.owner || !initialConfig.repo || !initialConfig.token;

const state = {
  view: needsInitialOnboarding ? "onboarding" : "workspace",
  config: initialConfig,
  records: initialCache.records,
  selectedId: initialCache.records[0]?.id || "",
  selectedProject: "",
  loading: false,
  toast: "",
  activityOpen: true,
  activityLog: [],
  demo: false,
  warnings: [],
  query: "",
  inboxStatus: "needs_triage",
  handoffTarget: "codex",
  onboardingBrief: "",
  diagnostics: null,
  diagnosticsLoading: false,
  runner: {
    loading: false,
    health: null,
    projects: [],
    runs: [],
    memory: null,
    error: ""
  },
  cacheMeta: {
    scope: initialCache.scope,
    syncedAt: initialCache.syncedAt
  }
};

function saveConfig(config) {
  state.config = saveAppConfig(config);
  const cache = loadRecordCache(state.config);
  state.records = cache.records;
  state.cacheMeta = {
    scope: cache.scope,
    syncedAt: cache.syncedAt
  };
  state.selectedId = state.records[0]?.id || "";
  state.selectedProject = "";
  state.demo = false;
  state.diagnostics = null;
  refreshWarnings();
}

function persistRecordCache() {
  if (state.demo) return;
  try {
    const cache = saveRecordCache(state.config, state.records);
    state.cacheMeta = {
      scope: cache.scope,
      syncedAt: cache.syncedAt
    };
  } catch {
    state.cacheMeta = {
      ...state.cacheMeta,
      syncedAt: ""
    };
  }
}

function addActivity(message, kind = "info", detail = "") {
  state.activityLog = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      kind,
      message,
      detail
    },
    ...state.activityLog
  ].slice(0, 24);
}

function setToast(message, kind = "info") {
  state.toast = message;
  addActivity(message, kind);
  render();
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 3600);
}

function setView(view) {
  state.view = view;
  keepSelectionVisible();
  render();
}

function setQuery(query) {
  state.query = query;
  keepSelectionVisible();
  render();
  const search = document.querySelector("[data-search]");
  if (search) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

function recordsByType(type) {
  return state.records.filter((record) => record.type === type);
}

function filteredRecords(type) {
  return filterRecords(recordsByType(type), state.query);
}

function keepSelectionVisible() {
  const type = primaryTypeForView(state.view);
  if (!type) return;
  const visible = state.view === "inbox" ? visibleInboxRecords() : filteredRecords(type);
  if (visible.length && !visible.some((record) => record.id === state.selectedId)) {
    state.selectedId = visible[0].id;
  }
}

function visibleInboxRecords() {
  const inbox = filteredRecords("inbox");
  if (state.inboxStatus === "all") return inbox;
  return inbox.filter((record) => record.status === state.inboxStatus);
}

function primaryTypeForView(view) {
  return {
    inbox: "inbox",
    board: "work_items",
    decisions: "decisions"
  }[view] || "";
}

function refreshWarnings() {
  state.warnings = validateMemoryRecords(state.records);
}

function onboardingChecklist() {
  return buildOnboardingChecklist({
    config: state.config,
    diagnostics: state.diagnostics,
    runner: state.runner,
    cacheMeta: state.cacheMeta,
    records: state.records,
    briefReady: Boolean(state.onboardingBrief)
  });
}

async function saveMemoryRecord(path, content, message) {
  const existing = state.records.find((record) => record.path === path);
  let sha = existing?.sha || `local-${Date.now()}`;
  if (!state.demo) {
    const result = await putFile(state.config, path, content, message, existing?.sha);
    sha = result?.content?.sha || sha;
  }
  const parsed = parseMemoryFile(path, content, sha);
  state.records = upsertRecord(state.records, parsed);
  refreshWarnings();
  persistRecordCache();
  return parsed;
}

async function syncFromGitHub() {
  if (!state.config.owner || !state.config.repo) {
    setToast("Önce GitHub memory repo bağlantısını kaydet.");
    return;
  }
  state.loading = true;
  render();
  try {
    state.demo = false;
    state.records = await loadMemoryRepo(state.config);
    refreshWarnings();
    persistRecordCache();
    state.selectedId = state.records[0]?.id || "";
    setToast(state.warnings.length ? "Memory repo yüklendi; format uyarıları var." : "Memory repo senkronize edildi.");
  } catch (error) {
    setToast(`Senkronizasyon başarısız: ${error.message}`);
  } finally {
    state.loading = false;
    render();
  }
}

function loadDemo() {
  state.records = demoRecords();
  refreshWarnings();
  state.selectedId = state.records[0]?.id || "";
  state.demo = true;
  setToast("Örnek veriler yüklendi.");
}

function selectedRecord(type = "") {
  const pool = type ? recordsByType(type) : state.records;
  return pool.find((record) => record.id === state.selectedId) || pool[0];
}

function contextRecord() {
  if (state.view === "handoff") return handoffAnchorRecord();
  if (state.view === "workspace") return selectedProjectWorkItem() || selectedProjectRecords()[0] || null;
  return state.view === "board" ? selectedRecord("work_items") : selectedRecord();
}

function handoffRecords() {
  return state.records.filter((record) => record.type === "work_items" || record.type === "inbox");
}

function handoffAnchorRecord() {
  const records = handoffRecords();
  return records.find((record) => record.id === state.selectedId) || records[0] || null;
}

function projectSummaries() {
  const map = new Map();
  for (const record of state.records) {
    const name = record.project || "genel";
    const current = map.get(name) || {
      name,
      repo: record.repo || "",
      records: 0,
      open: 0,
      risks: 0,
      latestAt: ""
    };
    current.records += 1;
    if (record.status && !["done", "archived", "linked"].includes(record.status)) current.open += 1;
    if (record.status === "blocked") current.risks += 1;
    current.repo ||= record.repo || "";
    const at = record.frontmatter?.updated_at || record.frontmatter?.created_at || record.frontmatter?.archived_at || "";
    if (new Date(at).getTime() > new Date(current.latestAt || 0).getTime()) current.latestAt = at;
    map.set(name, current);
  }
  for (const project of state.runner.projects) {
    const name = project.name || "proje";
    const current = map.get(name) || {
      name,
      repo: project.repo || "",
      records: 0,
      open: 0,
      risks: 0,
      latestAt: project.updatedAt || project.createdAt || ""
    };
    current.repo ||= project.repo || "";
    current.localPath = project.path;
    current.projectId = project.id;
    map.set(name, current);
  }
  return [...map.values()].sort((a, b) => (b.open - a.open) || a.name.localeCompare(b.name, "tr"));
}

function selectedProjectName() {
  const projects = projectSummaries();
  if (state.selectedProject && projects.some((project) => project.name === state.selectedProject)) {
    return state.selectedProject;
  }
  return projects[0]?.name || "";
}

function selectedProjectRecords() {
  const name = selectedProjectName();
  return name ? state.records.filter((record) => (record.project || "genel") === name) : state.records;
}

function selectedProjectRuns() {
  const name = selectedProjectName();
  return name ? state.runner.runs.filter((run) => (run.project?.name || "genel") === name) : state.runner.runs;
}

function selectedProjectEvents() {
  const name = selectedProjectName();
  const projects = name ? state.runner.projects.filter((project) => (project.name || "proje") === name) : state.runner.projects;
  return buildTimelineEvents(selectedProjectRecords(), projects, selectedProjectRuns());
}

function selectedProjectWorkItem() {
  return selectedProjectRecords().find((record) => record.type === "work_items" && record.status !== "done")
    || selectedProjectRecords().find((record) => record.type === "work_items")
    || null;
}

function memoryMirrorConfig() {
  if (!state.config.owner || !state.config.repo) return null;
  return {
    owner: state.config.owner,
    repo: state.config.repo,
    branch: state.config.branch || "main"
  };
}

async function createWorkFromSelected(targetWorkId = "") {
  const record = selectedRecord();
  if (!record || record.type !== "inbox") return;
  const work = buildWorkItemFromSession(record);
  const targetWork = targetWorkId
    ? state.records.find((item) => item.type === "work_items" && item.id === targetWorkId)
    : null;
  if (targetWorkId && !targetWork) {
    setToast("Bağlanacak iş kartı bulunamadı.");
    return;
  }
  const existingWork = targetWork || state.records.find((item) => item.type === "work_items" && item.id === work.id);
  const workContent = existingWork ? appendSessionToWorkItem(existingWork, record) : work.content;
  const workPath = existingWork ? existingWork.path : work.path;
  const linkedWorkId = existingWork?.id || work.id;

  const parsed = await saveMemoryRecord(
    workPath,
    workContent,
    existingWork ? `work: ${linkedWorkId} oturum bağlantısını güncelle` : `work: ${linkedWorkId} iş kartını oluştur`
  );
  const updatedInbox = replaceFrontmatter(record.raw, {
    status: "linked",
    linked_work_item: linkedWorkId
  });
  await saveMemoryRecord(record.path, updatedInbox, `inbox: ${record.id} iş kartına bağlandı`);
  state.view = "board";
  state.selectedId = parsed.id;
  setToast(existingWork ? "Oturum seçili iş kartına bağlandı." : "İş kartı oluşturuldu.");
}

async function archiveSelected() {
  const record = selectedRecord();
  if (!record || record.type !== "inbox") return;
  const fileName = record.path.split("/").pop();
  const archivePath = `archive/${fileName}`;
  const archivedContent = buildArchivedRecordContent(record);
  const parsed = await saveMemoryRecord(archivePath, archivedContent, `archive: ${record.id}`);
  if (!state.demo) {
    await deleteFile(state.config, record.path, record.sha, `archive: ${record.id} kaynak inbox kaydını sil`);
  }

  state.selectedId = parsed.id;
  refreshWarnings();
  setToast("Oturum kaydı arşivlendi.");
}

async function saveDecisionFromSelected() {
  const record = selectedRecord();
  if (!record) return;
  const decision = buildDecisionFromSession(record);
  if (!decision) {
    setToast("Bu oturumda karar bölümü bulunamadı.");
    return;
  }
  const savedDecision = await saveMemoryRecord(decision.path, decision.content, `decision: ${decision.id}`);
  const workItem = findWorkItemForSession(state.records, record);
  if (workItem) {
    const updatedWork = appendDecisionToWorkItem(workItem, savedDecision);
    await saveMemoryRecord(workItem.path, updatedWork, `work: ${workItem.id} karar bağlantısını güncelle`);
  }
  state.view = "decisions";
  setToast("Karar kaydı oluşturuldu.");
}

async function saveHandoff(target) {
  const record = contextRecord();
  if (!record) return;
  const prompt = buildContextPack(state.records, record, target);
  const content = `---
id: handoff_${record.id}_${target}
source_record: ${record.id}
target: ${target}
created_at: ${new Date().toISOString()}
---

# Devam Brifi

${prompt}
`;
  const path = `handoffs/handoff_${record.id}_${target}.md`;
  await saveMemoryRecord(path, content, `handoff: ${record.id} -> ${target}`);
  setToast("Devam brifi kaydı hazırlandı.");
}

async function updateSelectedWorkStatus(payload) {
  const status = typeof payload === "string" ? payload : payload?.status;
  const record = payload?.id
    ? state.records.find((item) => item.id === payload.id)
    : contextRecord();
  if (!record || record.type !== "work_items") {
    setToast("Durum değiştirmek için iş kartı seç.");
    return;
  }

  const content = updateWorkItemStatusContent(record, status);
  const parsed = await saveMemoryRecord(record.path, content, `work: ${record.id} durumunu ${status} yap`);
  state.selectedId = parsed.id;
  setToast("İş kartı durumu güncellendi.");
}

async function updateSelectedWorkNextAction(payload) {
  const record = state.records.find((item) => item.id === payload?.id);
  if (!record || record.type !== "work_items") {
    setToast("Sonraki adımı güncellemek için iş kartı seç.");
    return;
  }

  const content = updateWorkItemNextActionContent(record, payload.nextAction);
  const parsed = await saveMemoryRecord(record.path, content, `work: ${record.id} sonraki adımı güncelle`);
  state.selectedId = parsed.id;
  setToast("Sonraki adım güncellendi.");
}

async function initializeMemoryRepo() {
  if (!state.config.owner || !state.config.repo) {
    setToast("Önce repo bağlantısını kaydet.");
    return;
  }
  const created = await ensureMemoryRepo(state.config);
  setToast(created.length ? `Memory repo hazırlandı: ${created.length} dosya oluşturuldu.` : "Memory repo yapısı zaten hazır.");
  await syncFromGitHub();
}

async function runDiagnostics() {
  if (!state.config.owner || !state.config.repo) {
    setToast("Önce repo bağlantısını kaydet.");
    return;
  }
  state.diagnosticsLoading = true;
  render();
  try {
    state.diagnostics = await diagnoseMemoryRepo(state.config);
    setToast(state.diagnostics.ok ? "Repo tanılaması temiz." : "Repo tanılamasında uyarılar var.");
  } finally {
    state.diagnosticsLoading = false;
    render();
  }
}

async function refreshRunnerStatus(options = {}) {
  state.runner.loading = true;
  if (!options.silent) render();
  try {
    const memoryConfig = memoryMirrorConfig();
    const [health, registry, runsPayload] = await Promise.all([
      fetchRunnerHealth(),
      fetchRunnerProjects(),
      fetchRunnerRuns().catch(() => ({ runs: [] }))
    ]);
    const memory = memoryConfig ? await fetchMemoryMirrorStatus(memoryConfig).catch((error) => ({
      configured: false,
      error: error.message
    })) : null;
    state.runner = {
      loading: false,
      health,
      projects: Array.isArray(registry.projects) ? registry.projects : [],
      runs: Array.isArray(runsPayload.runs) ? runsPayload.runs : [],
      memory,
      error: ""
    };
    if (!options.silent) setToast("Yerel runner durumu güncellendi.");
  } catch (error) {
    state.runner = {
      ...state.runner,
      loading: false,
      error: error.message || "Yerel runner'a bağlanılamadı."
    };
    if (!options.silent) setToast(`Yerel runner hatası: ${state.runner.error}`);
  } finally {
    render();
  }
}

async function registerProjectFromForm(form) {
  const data = new FormData(form);
  await registerRunnerProject({
    name: data.get("name"),
    path: data.get("path"),
    repo: data.get("repo"),
    branch: data.get("branch") || "main"
  });
  setToast("Proje kökü yerel runner'a kaydedildi.");
  form.reset();
  await refreshRunnerStatus({ silent: true });
}

async function selectProjectRootForForm() {
  const result = await selectRunnerProjectDirectory();
  if (result.canceled || !result.path) return;
  const input = document.querySelector("[data-project-path]");
  if (input) input.value = result.path;
  setToast("Proje kökü seçildi.");
}

async function startCodexRunFromForm(form) {
  const data = new FormData(form);
  const projectId = data.get("projectId") || state.runner.projects[0]?.id || "";
  const run = await startRunnerCodexRun({
    projectId,
    automationLevel: data.get("automationLevel"),
    template: data.get("template"),
    prompt: data.get("prompt"),
    dryRun: data.get("dryRun") === "on"
  });
  state.runner.runs = [run, ...state.runner.runs.filter((item) => item.id !== run.id)].slice(0, 20);
  addActivity(`Codex run kaydı: ${run.id}`, run.status === "failed" ? "error" : "success", run.summary || run.error || "");
  setToast(run.status === "dry_run" ? "Codex dry-run kaydı hazırlandı." : "Codex run tamamlandı.", run.status === "failed" ? "error" : "success");
  form.reset();
  const dryRun = form.querySelector("input[name='dryRun']");
  if (dryRun) dryRun.checked = true;
}

async function syncMemoryMirrorFromConfig() {
  const config = memoryMirrorConfig();
  if (!config) {
    setToast("Önce Hafıza Bağlantısı ekranında GitHub memory repo bilgisini kaydet.");
    return;
  }
  const index = await syncMemoryMirror(config);
  state.runner.memory = {
    configured: true,
    owner: index.owner,
    repo: index.repo,
    branch: index.branch,
    cloneDir: index.cloneDir,
    indexFile: "",
    cloneExists: true,
    indexed: true,
    recordCount: index.recordCount,
    warningCount: index.warningCount,
    lastIndexedAt: index.indexedAt,
    lastCommit: index.lastCommit
  };
  addActivity(`Yerel memory mirror yenilendi: ${index.recordCount} kayıt`, index.warningCount ? "warning" : "success");
  setToast("Yerel memory mirror ve index güncellendi.", index.warningCount ? "warning" : "success");
}

async function saveOnboardingConfigFromForm(form) {
  const data = new FormData(form);
  const repoParts = parseRepoInput(data.get("repoInput"));
  saveConfig({
    ...repoParts,
    branch: data.get("branch") || "main",
    token: data.get("token") || ""
  });
  setToast("Hafıza bağlantısı kaydedildi.");
  await refreshRunnerStatus({ silent: true });
}

function generateOnboardingBrief() {
  const record = selectedProjectWorkItem() || selectedProjectRecords()[0] || state.records[0];
  state.onboardingBrief = record
    ? buildContextPack(state.records, record, "codex")
    : [
      "Codex için ctx-lab devam brifi",
      "",
      "Proje: ctx-lab",
      "Güncel durum: Hafıza reposu, yerel proje kökü ve Codex CLI kurulumunu tamamla.",
      "Sıradaki somut adım: İlk oturum özetini Oturum Akışı'na kaydet ve bir iş hattına bağla.",
      "Çalışma kuralı: Önce repo durumunu oku, sonra yalnızca hedefle ilgili değişiklikleri uygula."
    ].join("\n");
  addActivity("Örnek devam brifi üretildi.", "success");
  setToast("Örnek devam brifi hazır.");
}

function finishOnboarding() {
  const checklist = onboardingChecklist();
  if (!isOnboardingComplete(checklist)) {
    const missing = checklist.filter((item) => !item.done).map((item) => item.label).join(", ");
    setToast(`Kurulum henüz tamamlanmadı: ${missing}`);
    return;
  }
  state.view = "workspace";
  setToast("Kurulum tamamlandı. Proje Çalışma Merkezi açıldı.", "success");
}

async function createInboxSummaryFromForm(form) {
  if (!state.demo && (!state.config.owner || !state.config.repo)) {
    setToast("Önce GitHub memory repo bağlantısını kaydet.");
    return;
  }
  const data = new FormData(form);
  const fallback = {
    source: data.get("source"),
    project: data.get("project"),
    repo: data.get("repo"),
    branch: data.get("branch"),
    tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean)
  };
  const rawMarkdown = String(data.get("raw_markdown") || "").trim();
  const summary = rawMarkdown ? buildInboxSessionSummaryFromMarkdown(rawMarkdown, fallback) : buildInboxSessionSummary({
    ...fallback,
    goal: data.get("goal"),
    happened: data.get("happened"),
    decisions: data.get("decisions"),
    questions: data.get("questions"),
    next: data.get("next"),
    evidence: data.get("evidence")
  });

  const parsed = await saveMemoryRecord(summary.path, summary.content, `inbox: ${summary.id} oturum özetini ekle`);
  state.selectedId = parsed.id;
  state.view = "inbox";
  setToast("Oturum özeti oturum akışına eklendi.");
}

async function createManualWorkFromForm(form) {
  if (!state.demo && (!state.config.owner || !state.config.repo)) {
    setToast("Önce GitHub memory repo bağlantısını kaydet.");
    return;
  }
  const data = new FormData(form);
  const work = buildManualWorkItem({
    title: data.get("title"),
    project: data.get("project"),
    repo: data.get("repo"),
    branch: data.get("branch"),
    priority: data.get("priority"),
    objective: data.get("objective"),
    current: data.get("current"),
    next: data.get("next"),
    risks: data.get("risks")
  });

  const parsed = await saveMemoryRecord(work.path, work.content, `work: ${work.id} manuel iş hattı oluştur`);
  state.selectedId = parsed.id;
  state.view = "board";
  setToast("Yeni iş hattı oluşturuldu.");
}

async function createManualDecisionFromForm(form) {
  if (!state.demo && (!state.config.owner || !state.config.repo)) {
    setToast("Önce GitHub memory repo bağlantısını kaydet.");
    return;
  }
  const data = new FormData(form);
  const workItemId = data.get("work_item") || "";
  const workItem = workItemId
    ? state.records.find((record) => record.type === "work_items" && record.id === workItemId)
    : null;
  const decision = buildManualDecision({
    title: data.get("title"),
    project: data.get("project") || workItem?.project || "",
    workItemId,
    decision: data.get("decision"),
    rationale: data.get("rationale"),
    impact: data.get("impact"),
    source: data.get("source"),
    tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean)
  });

  const savedDecision = await saveMemoryRecord(decision.path, decision.content, `decision: ${decision.id} manuel karar oluştur`);
  if (workItem) {
    const updatedWork = appendDecisionToWorkItem(workItem, savedDecision);
    await saveMemoryRecord(workItem.path, updatedWork, `work: ${workItem.id} karar bağlantısını güncelle`);
  }
  state.selectedId = savedDecision.id;
  state.view = "decisions";
  setToast(workItem ? "Karar kaydı oluşturuldu ve iş hattına bağlandı." : "Karar kaydı oluşturuldu.");
}

function closePromptText() {
  const record = selectedRecord();
  return buildSessionClosePrompt({
    source: "codex",
    project: record?.project || "ctx-lab",
    repo: record?.repo || "cagrisahin58/ctx-lab",
    branch: record?.branch || "main"
  });
}

async function copyClosePrompt() {
  await navigator.clipboard.writeText(closePromptText());
  setToast("Oturum kapanış prompt'u kopyalandı.");
}

async function copyContextPack(target = "codex") {
  const record = contextRecord();
  if (!record) return;
  await navigator.clipboard.writeText(buildContextPack(state.records, record, target));
  setToast("Devam brifi kopyalandı.");
}

function dailyBriefText(target = "codex") {
  return buildDailyBrief(state.records, target);
}

async function copyDailyBrief() {
  await navigator.clipboard.writeText(dailyBriefText("codex"));
  setToast("Günlük brif kopyalandı.");
}

async function saveDailyBrief() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const id = `daily_${stamp}`;
  const content = `---
id: ${id}
target: codex
created_at: ${now.toISOString()}
---

# Günlük Devam Brifi

${dailyBriefText("codex")}
`;
  await saveMemoryRecord(`handoffs/${id}.md`, content, `handoff: ${id} günlük brif`);
  setToast("Günlük brif devam brifi olarak kaydedildi.");
}

function render() {
  const counts = {
    inbox: recordsByType("inbox").length,
    work: recordsByType("work_items").length,
    decisions: recordsByType("decisions").length,
    archive: recordsByType("archive").length,
    active: recordsByType("work_items").filter((record) => record.status === "active").length,
    waiting: recordsByType("work_items").filter((record) => record.status === "waiting").length,
    blocked: recordsByType("work_items").filter((record) => record.status === "blocked").length
  };

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>ctx-lab</h1>
          <span>AI çalışma hafızası</span>
        </div>
        <nav class="nav" aria-label="Ana gezinme">
          ${navButton("onboarding", "Kurulum")}
          ${navButton("workspace", "Proje Çalışma Merkezi")}
          ${navButton("inbox", `Oturum Akışı (${counts.inbox})`)}
          ${navButton("new-summary", "Yeni Oturum Özeti")}
          ${navButton("board", `İş Akışı (${counts.work})`)}
          ${navButton("decisions", `Karar Defteri (${counts.decisions})`)}
          ${navButton("handoff", "Devam Brifi")}
          ${navButton("daily", "Günlük Devam Brifi")}
          ${navButton("runner", "Yerel Codex Runner")}
          ${navButton("settings", "Hafıza Bağlantısı")}
        </nav>
        ${renderProjectRail()}
        <div class="sync-panel">
          <span>${state.demo ? "Örnek veri modu" : repoLabel()}</span>
          ${state.demo ? "" : `<span class="cache-meta">${cacheLabel()}</span>`}
          <button class="primary" data-action="sync" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "Senkronize ediliyor" : "GitHub'dan Yenile"}
          </button>
          <button class="ghost" data-action="demo">Örnek verilerle dene</button>
        </div>
      </aside>
      <main class="content">
        ${renderStatusBar()}
        ${renderCurrentView(counts)}
      </main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;

  bindEvents();
}

function navButton(view, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function repoLabel() {
  return state.config.owner && state.config.repo
    ? `${state.config.owner}/${state.config.repo} · ${state.config.branch || "main"}`
    : "Memory repo bağlı değil";
}

function cacheLabel() {
  if (!state.cacheMeta.syncedAt) return "Yerel önbellek yok";
  const date = new Date(state.cacheMeta.syncedAt);
  const label = Number.isNaN(date.getTime())
    ? state.cacheMeta.syncedAt
    : date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  return `Yerel önbellek: ${state.records.length} kayıt · ${label}`;
}

function renderProjectRail() {
  const projects = projectSummaries();
  if (!projects.length) {
    return `<div class="project-rail empty-rail">Henüz proje kaydı yok.</div>`;
  }
  const selected = selectedProjectName();
  return `
    <div class="project-rail">
      <div class="rail-title">Projeler</div>
      <div class="project-list">
        ${projects.map((project) => `
          <button class="project-pill ${project.name === selected ? "active" : ""}" data-action="select-project" data-project="${escapeHtml(project.name)}">
            <strong>${escapeHtml(project.name)}</strong>
            <span>${escapeHtml(project.repo || project.localPath || "repo belirtilmedi")}</span>
            <small>${project.open} açık · ${project.records} kayıt</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderStatusBar() {
  const runner = state.runner.health;
  const codex = runner?.codex;
  const memoryStatus = state.demo ? "Örnek veri" : (state.cacheMeta.syncedAt ? "Yerel cache hazır" : "Yerel cache yok");
  const githubStatus = state.config.owner && state.config.repo ? "GitHub bağlı" : "GitHub bekliyor";
  const codexStatus = codex?.available ? `Codex ${codex.version}` : (state.runner.error || "Codex kontrol bekliyor");
  const mirror = state.runner.memory;
  const mirrorStatus = mirror?.indexed ? `Mirror index: ${mirror.recordCount} kayıt` : (mirror?.error || "Mirror bekliyor");
  return `
    <div class="status-bar">
      <span class="status-dot ok"></span><span>${escapeHtml(githubStatus)}</span>
      <span class="status-dot ${state.cacheMeta.syncedAt || state.demo ? "ok" : "warn"}"></span><span>${escapeHtml(memoryStatus)}</span>
      <span class="status-dot ${mirror?.indexed ? "ok" : "warn"}"></span><span>${escapeHtml(mirrorStatus)}</span>
      <span class="status-dot ${codex?.available ? "ok" : "warn"}"></span><span>${escapeHtml(codexStatus)}</span>
      <button class="ghost compact" data-action="refresh-runner">Runner</button>
    </div>
  `;
}

function renderWorkspace(counts) {
  const projectName = selectedProjectName();
  const records = selectedProjectRecords();
  const workItem = selectedProjectWorkItem();
  const events = selectedProjectEvents();
  const activeRuns = selectedProjectRuns();
  const summary = projectSummaries().find((project) => project.name === projectName);
  const next = workItem ? getSection(workItem.sections, "next") || workItem.nextAction || "Sıradaki somut adım kayıtlarda yok." : "Önce proje için bir iş hattı seç veya oluştur.";
  const current = workItem ? getSection(workItem.sections, "current") || workItem.summary || "Güncel durum kayıtlarda yok." : "Bu proje için açık iş hattı bulunamadı.";
  const risks = workItem ? getSection(workItem.sections, "risks") || "Açık risk kaydı yok." : "Risk bilgisi için iş hattı gerekli.";

  return `
    ${renderHeader(
      "Proje Çalışma Merkezi",
      "Oturumları, kararları, iş hattı değişimlerini, Codex run kayıtlarını ve GitHub senkronizasyonunu tek timeline içinde izle.",
      `<button data-view="new-summary">Yeni Oturum</button><button class="primary" data-action="copy-context-pack">Devam Brifi</button>`
    )}
    <section class="workspace-grid">
      <div class="workspace-main">
        <div class="metric-strip">
          ${metricCard("Açık iş", counts.active + counts.waiting + counts.blocked)}
          ${metricCard("İşleme bekliyor", counts.inbox)}
          ${metricCard("Karar", counts.decisions)}
          ${metricCard("Codex run", activeRuns.length)}
        </div>
        <div class="panel timeline-panel">
          <div class="panel-heading">
            <div>
              <h3>${escapeHtml(projectName || "Proje seçilmedi")}</h3>
              <p>${escapeHtml(summary?.repo || "Repo bilgisi yok")}</p>
            </div>
            <span class="badge">${records.length} kayıt</span>
          </div>
          <div class="timeline">
            ${events.length ? events.map(renderTimelineEvent).join("") : `<div class="empty">Bu proje için timeline olayı yok.</div>`}
          </div>
        </div>
      </div>
      <aside class="context-pane">
        <div class="panel context-card">
          <div class="panel-heading">
            <div>
              <h3>Güncel Bağlam</h3>
              <p>${escapeHtml(workItem?.title || projectName || "İş hattı seçilmedi")}</p>
            </div>
            ${workItem ? `<span class="badge ${workItem.status}">${statusLabel(workItem.status)}</span>` : ""}
          </div>
          ${detailSection("Güncel durum özeti", current)}
          ${detailSection("Sıradaki somut adım", next)}
          ${detailSection("Açık riskler", risks)}
          <div class="context-actions">
            <button class="primary" data-action="copy-context-pack">Tek tıkla devam brifi</button>
            <button data-action="save-handoff-codex">Devam brifini kaydet</button>
          </div>
        </div>
        ${renderCodexRunPanel()}
        ${renderActivityLog()}
      </aside>
    </section>
  `;
}

function metricCard(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderTimelineEvent(event) {
  return `
    <button class="timeline-event ${event.kind}" data-record-id="${escapeHtml(event.recordId || "")}">
      <span class="timeline-marker"></span>
      <span class="timeline-body">
        <span class="timeline-top">
          <strong>${escapeHtml(event.label)}</strong>
          <small>${formatDate(event.at)}</small>
        </span>
        <span class="timeline-title">${escapeHtml(event.title || event.recordId || "Kayıt")}</span>
        <span class="timeline-summary">${escapeHtml(event.summary || "Özet yok.")}</span>
        <span class="meta">${escapeHtml(event.repo || event.path || "")}${event.status ? ` · ${escapeHtml(statusLabel(event.status))}` : ""}</span>
      </span>
    </button>
  `;
}

function renderCodexRunPanel() {
  const projects = state.runner.projects;
  return `
    <form class="panel codex-run-form" id="codex-run-form">
      <div class="panel-heading">
        <div>
          <h3>Codex'e Devret</h3>
          <p>Varsayılan dry-run; run logları yerel app-data altında tutulur.</p>
        </div>
      </div>
      <label>Proje kökü
        <select name="projectId" ${projects.length ? "" : "disabled"}>
          ${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)} · ${escapeHtml(project.path)}</option>`).join("")}
        </select>
      </label>
      <div class="form-row">
        <label>Seviye
          <select name="automationLevel">
            <option value="brief">Sadece brif hazırla</option>
            <option value="suggest">Öneri üret</option>
            <option value="edit_no_commit">Dosya değiştir, commit atma</option>
            <option value="test">Test çalıştır</option>
            <option value="commit_prepare">Commit hazırla</option>
            <option value="commit_push">Commit + push</option>
          </select>
        </label>
        <label>Şablon
          <select name="template">
            <option value="continue_work">Devam çalışması</option>
            <option value="review">Kod inceleme</option>
            <option value="test_fix">Test düzeltme</option>
            <option value="release_check">Yayın kontrolü</option>
          </select>
        </label>
      </div>
      <label>Prompt
        <textarea name="prompt" required placeholder="Codex'e verilecek kontrollü görev...">${escapeHtml(workItemPromptSeed())}</textarea>
      </label>
      <label class="check-row"><input type="checkbox" name="dryRun" checked> Dry-run olarak kaydet</label>
      <button class="primary" type="submit" ${projects.length ? "" : "disabled"}>Run kaydı oluştur</button>
      ${state.runner.runs.length ? `<div class="run-list">${state.runner.runs.slice(0, 4).map(renderRunMini).join("")}</div>` : ""}
    </form>
  `;
}

function workItemPromptSeed() {
  const workItem = selectedProjectWorkItem();
  if (!workItem) return "Seçili proje için mevcut durumu analiz et ve devam brifi üret.";
  return [
    `İş hattı: ${workItem.title}`,
    `Güncel durum: ${getSection(workItem.sections, "current") || workItem.summary || ""}`,
    `Sıradaki adım: ${getSection(workItem.sections, "next") || workItem.nextAction || ""}`
  ].filter(Boolean).join("\n");
}

function renderRunMini(run) {
  return `
    <div class="run-mini">
      <strong>${escapeHtml(run.id)}</strong>
      <span>${escapeHtml(run.status)} · ${escapeHtml(run.automationLevel || "")}</span>
    </div>
  `;
}

function renderActivityLog() {
  return `
    <div class="panel activity-log">
      <div class="panel-heading">
        <div>
          <h3>Çalışma Günlüğü</h3>
          <p>Son kullanıcı aksiyonları ve runner olayları.</p>
        </div>
      </div>
      <div class="activity-items">
        ${state.activityLog.length ? state.activityLog.map((item) => `
          <div class="activity-item ${item.kind}">
            <strong>${escapeHtml(item.message)}</strong>
            <span>${formatDate(item.at)}${item.detail ? ` · ${escapeHtml(item.detail)}` : ""}</span>
          </div>
        `).join("") : `<div class="empty">Henüz çalışma günlüğü olayı yok.</div>`}
      </div>
    </div>
  `;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "tarih yok";
  return date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function renderOnboarding() {
  const checklist = onboardingChecklist();
  const complete = isOnboardingComplete(checklist);
  return `
    ${renderHeader(
      "Kısa Kurulum",
      "ctx-lab'i gerçek bir masaüstü çalışma merkezine bağlamak için gerekli ilk kontroller.",
      `<button data-action="demo">Önce Gez</button><button class="primary" data-action="finish-onboarding" ${complete ? "" : "disabled"}>Çalışma Merkezine Geç</button>`
    )}
    <section class="onboarding-grid">
      <div class="panel onboarding-progress">
        <div class="panel-heading">
          <div>
            <h3>Kurulum Akışı</h3>
            <p>${checklist.filter((item) => item.done).length}/${checklist.length} adım tamamlandı.</p>
          </div>
        </div>
        <div class="setup-steps">
          ${checklist.map((item) => `
            <div class="setup-step ${item.done ? "done" : ""}">
              <span class="setup-mark">${item.done ? "✓" : "•"}</span>
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <p>${escapeHtml(item.description)}</p>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="onboarding-actions">
        <section class="panel">
          <h3>GitHub Hafıza Reposu</h3>
          <form class="connection-form" id="onboarding-config-form">
            <label>
              Repo
              <input name="repoInput" placeholder="cagrisahin58/work-memory veya GitHub URL" value="${escapeHtml(state.config.owner && state.config.repo ? `${state.config.owner}/${state.config.repo}` : "")}" />
            </label>
            <label>
              Branch
              <input name="branch" placeholder="main" value="${escapeHtml(state.config.branch || "main")}" />
            </label>
            <label class="full">
              GitHub Token
              <input name="token" type="password" placeholder="Fine-grained token, Contents read/write" value="${escapeHtml(state.config.token || "")}" />
            </label>
            <div class="toolbar-actions full">
              <button class="primary" type="submit">Bağlantıyı Kaydet</button>
              <button type="button" data-action="init-repo">Repo Yapısını Hazırla</button>
              <button type="button" data-action="diagnose-repo" ${state.diagnosticsLoading ? "disabled" : ""}>${state.diagnosticsLoading ? "Tanılanıyor" : "Bağlantıyı Tanıla"}</button>
              <button type="button" data-action="sync">GitHub'dan Yenile</button>
            </div>
          </form>
        </section>
        <section class="panel">
          <h3>Yerel Masaüstü Omurgası</h3>
          <div class="toolbar-actions">
            <button data-action="refresh-runner">Codex CLI Kontrolü</button>
            <button data-action="sync-memory-mirror" ${memoryMirrorConfig() ? "" : "disabled"}>Yerel Mirror Oluştur</button>
          </div>
          ${renderRunnerSnapshot()}
        </section>
        <section class="panel">
          <h3>Proje Kökü Seç</h3>
          <form class="connection-form" id="onboarding-project-form">
            <label>
              Proje Adı
              <input name="name" required placeholder="ctx-lab" />
            </label>
            <label>
              Repo
              <input name="repo" placeholder="cagrisahin58/ctx-lab" />
            </label>
            <label>
              Branch
              <input name="branch" placeholder="main" value="main" />
            </label>
            <label>
              Yerel Klasör
              <input name="path" data-project-path required placeholder="C:\\Users\\cagri\\projects\\projeler\\ai_hooks" />
            </label>
            <div class="toolbar-actions full">
              <button type="button" data-action="select-project-root">Klasör Seç</button>
              <button class="primary" type="submit">Proje Kökünü Kaydet</button>
            </div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h3>Örnek Devam Brifi</h3>
              <p>Kurulum bitmeden önce temiz Codex oturumuna verilecek metni kontrol et.</p>
            </div>
            <button class="primary" data-action="generate-onboarding-brief">Örnek Devam Brifi Üret</button>
          </div>
          ${state.onboardingBrief ? `<pre class="handoff-output">${escapeHtml(state.onboardingBrief)}</pre>` : `<div class="empty">Henüz brif üretilmedi.</div>`}
        </section>
      </div>
    </section>
  `;
}

function renderRunnerSnapshot() {
  const codex = state.runner.health?.codex || {};
  const memory = state.runner.memory;
  return `
    <div class="diagnostic-list">
      <div class="diagnostic-item ${codex.available ? "ok" : "fail"}">
        <span class="badge ${codex.available ? "active" : "blocked"}">${codex.available ? "Hazır" : "Eksik"}</span>
        <strong>Codex CLI</strong>
        <span>${codex.available ? escapeHtml(codex.version) : escapeHtml(codex.error || state.runner.error || "Kontrol bekliyor")}</span>
      </div>
      <div class="diagnostic-item ${memory?.indexed ? "ok" : "fail"}">
        <span class="badge ${memory?.indexed ? "active" : "waiting"}">${memory?.indexed ? "Hazır" : "Bekliyor"}</span>
        <strong>Memory mirror</strong>
        <span>${memory?.indexed ? `${memory.recordCount} kayıt` : escapeHtml(memory?.error || "Mirror bekliyor")}</span>
      </div>
      <div class="diagnostic-item ${state.runner.projects.length ? "ok" : "fail"}">
        <span class="badge ${state.runner.projects.length ? "active" : "waiting"}">${state.runner.projects.length ? "Hazır" : "Bekliyor"}</span>
        <strong>Proje kökü</strong>
        <span>${state.runner.projects.length ? `${state.runner.projects.length} kayıtlı kök` : "Kayıtlı proje kökü yok"}</span>
      </div>
    </div>
  `;
}

function renderCurrentView(counts) {
  if (state.view === "onboarding") return renderOnboarding();
  if (state.view === "workspace") return renderWorkspace(counts);
  if (state.view === "settings") return renderSettings();
  if (state.view === "new-summary") return renderNewSummary();
  if (state.view === "new-work") return renderNewWork();
  if (state.view === "new-decision") return renderNewDecision();
  if (state.view === "board") return renderBoard();
  if (state.view === "decisions") return renderDecisions();
  if (state.view === "handoff") return renderHandoff();
  if (state.view === "daily") return renderDailyBrief();
  if (state.view === "runner") return renderRunner();
  return renderInbox(counts);
}

function renderHeader(title, subtitle, actions = "") {
  return `
    <div class="toolbar">
      <div class="page-title">
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      <div class="toolbar-actions">${actions}</div>
    </div>
  `;
}

function renderInbox(counts) {
  const inbox = visibleInboxRecords();
  const selected = inbox.find((record) => record.id === state.selectedId) || inbox[0];
  return `
    ${renderHeader(
      "Oturum Akışı",
      "Claude, Codex veya diğer araçlardan gelen oturum özetlerini işlenebilir bağlama dönüştür.",
      `<button data-view="new-summary">Yeni Oturum Özeti</button><button data-action="sync">Yenile</button><button class="primary" data-action="demo">Örnek Veri</button>`
    )}
    <div class="filter-row">
      ${renderSearchBar("Oturum akışında ara")}
      <select class="status-select" data-inbox-status aria-label="Oturum durum filtresi">
        <option value="needs_triage" ${state.inboxStatus === "needs_triage" ? "selected" : ""}>İşleme Bekliyor</option>
        <option value="linked" ${state.inboxStatus === "linked" ? "selected" : ""}>Bağlandı</option>
        <option value="archived" ${state.inboxStatus === "archived" ? "selected" : ""}>Arşiv</option>
        <option value="all" ${state.inboxStatus === "all" ? "selected" : ""}>Tümü</option>
      </select>
    </div>
    ${state.warnings.length ? renderWarnings() : ""}
    <div class="stats">
      <div class="stat"><strong>${counts.inbox}</strong><span>Oturum kaydı</span></div>
      <div class="stat"><strong>${counts.work}</strong><span>İş kartı</span></div>
      <div class="stat"><strong>${counts.decisions}</strong><span>Karar</span></div>
      <div class="stat"><strong>${counts.archive}</strong><span>Arşiv</span></div>
    </div>
    <div class="grid two">
      <section class="record-list">
        ${inbox.length ? inbox.map(renderRecordCard).join("") : `<div class="empty">Oturum akışı boş. Hafıza reposuna oturum özeti ekleyin veya örnek veri yükleyin.</div>`}
      </section>
      <section class="panel detail">
        ${selected ? renderRecordDetail(selected, true) : `<div class="empty">İncelemek için bir kayıt seçin.</div>`}
      </section>
    </div>
  `;
}

function renderWarnings() {
  return `
    <section class="panel">
      <h3>Format Uyarıları</h3>
      <div class="record-list">
        ${state.warnings.map((warning) => `<span class="badge blocked">${escapeHtml(warning)}</span>`).join("")}
      </div>
    </section>
  `;
}

function renderBoard() {
  const workItems = filteredRecords("work_items");
  const groups = groupByStatus(workItems);
  const selected = workItems.find((record) => record.id === state.selectedId) || workItems[0];
  const columns = [
    ["active", "Aktif"],
    ["waiting", "Beklemede"],
    ["blocked", "Engelli"],
    ["done", "Tamamlandı"]
  ];
  return `
    ${renderHeader(
      "İş Akışı",
      "Kalıcı gerçeklik burada tutulur; oturum akışı sadece işleme bekleyen kayıt alanıdır.",
      `<button class="primary" data-view="new-work">Yeni İş Hattı</button>`
    )}
    ${renderSearchBar("İş kartı, proje veya durum ara")}
    <div class="board-layout">
      <div class="board">
        ${columns.map(([status, title]) => `
          <section class="column">
            <h3>${title}</h3>
            ${(groups[status] || []).map(renderRecordCard).join("") || `<div class="empty">Kayıt yok.</div>`}
          </section>
        `).join("")}
      </div>
      <section class="panel detail">
        ${selected ? renderWorkContext(selected) : `<div class="empty">İş kartı seçin.</div>`}
      </section>
    </div>
  `;
}

function renderNewWork() {
  return `
    ${renderHeader("Yeni İş Hattı", "Oturum akışını beklemeden takip edilecek bağımsız bir çalışma hattı aç.")}
    <section class="panel">
      <form class="connection-form" id="work-form">
        <label>
          Başlık
          <input name="title" required placeholder="AI Work Memory v1" />
        </label>
        <label>
          Proje
          <input name="project" placeholder="ctx-lab" />
        </label>
        <label>
          Repo
          <input name="repo" placeholder="cagrisahin58/ctx-lab" />
        </label>
        <label>
          Branch
          <input name="branch" placeholder="main" value="main" />
        </label>
        <label>
          Öncelik
          <select name="priority">
            <option value="normal">Normal</option>
            <option value="high">Yüksek</option>
            <option value="low">Düşük</option>
          </select>
        </label>
        <label class="full">
          Amaç
          <textarea name="objective" required placeholder="Bu iş hattı neyi başarmalı?"></textarea>
        </label>
        <label class="full">
          Güncel Durum
          <textarea name="current" placeholder="Şu an bilinen durum nedir?"></textarea>
        </label>
        <label class="full">
          Sonraki Adım
          <textarea name="next" required placeholder="Bir sonraki somut adım nedir?"></textarea>
        </label>
        <label class="full">
          Riskler / Engeller
          <textarea name="risks" placeholder="Açık risk, bağımlılık veya engel var mı?"></textarea>
        </label>
        <div class="toolbar-actions full">
          <button class="primary" type="submit">İş Hattını Oluştur</button>
          <button type="button" data-view="board">Vazgeç</button>
        </div>
      </form>
    </section>
  `;
}

function renderDecisions() {
  const decisions = filteredRecords("decisions");
  return `
    ${renderHeader(
      "Karar Defteri",
      "Neyi neden seçtiğimizi oturum geçmişinden bağımsız saklar.",
      `<button class="primary" data-view="new-decision">Yeni Karar</button>`
    )}
    ${renderSearchBar("Karar kayıtlarında ara")}
    <div class="grid">
      ${decisions.length ? decisions.map((record) => `<section class="panel">${renderRecordDetail(record, false)}</section>`).join("") : `<div class="empty">Henüz karar kaydı yok.</div>`}
    </div>
  `;
}

function renderNewDecision() {
  const workItems = recordsByType("work_items");
  return `
    ${renderHeader("Yeni Karar", "Oturum geçmişinden bağımsız, kaynaklı ve iş hattına bağlanabilir karar kaydı oluştur.")}
    <section class="panel">
      <form class="connection-form" id="decision-form">
        <label>
          Başlık
          <input name="title" required placeholder="Memory repo kaynak olacak" />
        </label>
        <label>
          İş Hattı
          <select name="work_item">
            <option value="">Bağlama</option>
            ${workItems.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("")}
          </select>
        </label>
        <label>
          Proje
          <input name="project" placeholder="ctx-lab" />
        </label>
        <label>
          Etiketler
          <input name="tags" placeholder="architecture, github-memory" />
        </label>
        <label class="full">
          Karar
          <textarea name="decision" required placeholder="Alınan karar nedir?"></textarea>
        </label>
        <label class="full">
          Gerekçe
          <textarea name="rationale" placeholder="Bu karar neden alındı?"></textarea>
        </label>
        <label class="full">
          Etki
          <textarea name="impact" placeholder="Bu karar hangi akışları etkiler?"></textarea>
        </label>
        <label class="full">
          Kaynak
          <textarea name="source" placeholder="Oturum, commit, dosya veya kısa kanıt notu"></textarea>
        </label>
        <div class="toolbar-actions full">
          <button class="primary" type="submit">Kararı Kaydet</button>
          <button type="button" data-view="decisions">Vazgeç</button>
        </div>
      </form>
    </section>
  `;
}

function renderHandoff() {
  const records = handoffRecords();
  const selected = handoffAnchorRecord();
  const prompt = selected ? buildContextPack(state.records, selected, state.handoffTarget) : "";
  return `
    ${renderHeader("Devam Brifi", "Seçili iş hattı veya oturum kaydından Codex/Claude devam brifi üret.")}
    <section class="panel detail">
      ${selected ? `
        <div class="filter-row">
          <select data-handoff-record aria-label="Devam brifi kaynak kaydı">
            ${records.map((record) => `<option value="${escapeHtml(record.id)}" ${selected.id === record.id ? "selected" : ""}>${escapeHtml(record.title)} · ${escapeHtml(record.type)}</option>`).join("")}
          </select>
          <select class="status-select" data-handoff-target aria-label="Devam brifi hedefi">
            <option value="codex" ${state.handoffTarget === "codex" ? "selected" : ""}>Codex</option>
            <option value="claude" ${state.handoffTarget === "claude" ? "selected" : ""}>Claude Code</option>
          </select>
        </div>
        <h3>${escapeHtml(selected.title)}</h3>
        <div class="toolbar-actions">
          <button class="primary" data-action="save-handoff-current">Devam Brifini Kaydet</button>
          <button data-action="copy-handoff">Kopyala</button>
        </div>
        <pre class="handoff-output">${escapeHtml(prompt)}</pre>
      ` : `<div class="empty">Devam brifi üretmek için önce bir oturum kaydı veya iş hattı oluşturun.</div>`}
    </section>
  `;
}

function renderDailyBrief() {
  const brief = dailyBriefText("codex");
  return `
    ${renderHeader("Günlük Devam Brifi", "Açık iş hatlarını, işleme bekleyen kayıtları ve sıradaki adımları tek devam metninde topla.")}
    <section class="panel detail">
      <div class="toolbar-actions">
        <button class="primary" data-action="copy-daily-brief">Brifi Kopyala</button>
        <button data-action="save-daily-brief">Devam Brifi Olarak Kaydet</button>
      </div>
      <pre class="handoff-output">${escapeHtml(brief)}</pre>
    </section>
  `;
}

function renderWorkContext(workItem) {
  const prompt = buildContextPack(state.records, workItem, "codex");
  const nextAction = getSection(workItem.sections, "next");
  return `
    <h3>${escapeHtml(workItem.title)}</h3>
    <div class="meta">
      <span class="badge ${workItem.status}">${statusLabel(workItem.status)}</span>
      <span>${escapeHtml(workItem.path)}</span>
    </div>
    <div class="toolbar-actions">
      <button class="primary" data-action="copy-context-pack">Devam Brifini Kopyala</button>
      <button data-action="save-handoff-codex">Devam Brifini Kaydet</button>
      <select class="status-select" data-status-select data-work-id="${escapeHtml(workItem.id)}" aria-label="İş kartı durumu">
        ${WORK_STATUSES.map((status) => `<option value="${status}" ${workItem.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
      </select>
    </div>
    ${detailSection("Amaç", getSection(workItem.sections, "objective"))}
    ${detailSection("Güncel Durum", getSection(workItem.sections, "current"))}
    <form class="quick-update-form" data-next-action-form data-work-id="${escapeHtml(workItem.id)}">
      <label>
        Sonraki Adım
        <textarea name="next_action" required>${escapeHtml(nextAction)}</textarea>
      </label>
      <div class="toolbar-actions">
        <button type="submit">Sonraki Adımı Güncelle</button>
      </div>
    </form>
    <div class="section">
      <h4>Devam Brifi</h4>
      <pre>${escapeHtml(prompt)}</pre>
    </div>
  `;
}

function renderSearchBar(placeholder) {
  return `
    <section class="search-strip">
      <input data-search placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.query)}" />
      ${state.query ? `<button data-action="clear-search">Temizle</button>` : ""}
    </section>
  `;
}

function renderNewSummary() {
  return `
    ${renderHeader("Yeni Oturum Özeti", "Claude veya Codex sohbetinden sonra temiz, insan-onaylı bir kayıt oluştur.")}
    <section class="panel">
      <div class="section">
        <h3>Oturum Kapanış Prompt'u</h3>
        <pre class="handoff-output">${escapeHtml(closePromptText())}</pre>
        <div class="toolbar-actions">
          <button class="primary" data-action="copy-close-prompt">Prompt'u Kopyala</button>
        </div>
      </div>
    </section>
    <section class="panel">
      <form class="connection-form" id="summary-form">
        <label>
          Kaynak
          <select name="source">
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
            <option value="manual">Manuel</option>
          </select>
        </label>
        <label>
          Proje
          <input name="project" placeholder="ctx-lab" />
        </label>
        <label>
          Repo
          <input name="repo" placeholder="cagrisahin58/ctx-lab" />
        </label>
        <label>
          Branch
          <input name="branch" placeholder="main" value="main" />
        </label>
        <label class="full">
          Etiketler
          <input name="tags" placeholder="architecture, github-memory" />
        </label>
        <label class="full">
          Hazır Markdown
          <textarea name="raw_markdown" placeholder="AI oturum kapanış prompt'undan gelen markdown özetini buraya yapıştır. Bu alan doluysa aşağıdaki detay alanları yedek bilgi olarak kullanılır."></textarea>
        </label>
        <label class="full">
          Amaç
          <textarea name="goal" placeholder="Bu oturumun hedefi neydi?"></textarea>
        </label>
        <label class="full">
          Yapılanlar
          <textarea name="happened" placeholder="- Yapılan iş ve önemli ilerlemeler"></textarea>
        </label>
        <label class="full">
          Kararlar
          <textarea name="decisions" placeholder="- Alınan kararlar"></textarea>
        </label>
        <label class="full">
          Açık Sorular
          <textarea name="questions" placeholder="- Netleşmesi gerekenler"></textarea>
        </label>
        <label class="full">
          Sonraki Adımlar
          <textarea name="next" placeholder="- Bir sonraki somut adım"></textarea>
        </label>
        <label class="full">
          Kanıtlar
          <textarea name="evidence" placeholder="- Dosya, commit, PR veya sohbet referansı"></textarea>
        </label>
        <div class="toolbar-actions full">
          <button class="primary" type="submit">Oturum Akışına Kaydet</button>
          <button type="button" data-view="inbox">Vazgeç</button>
        </div>
      </form>
    </section>
  `;
}

function renderSettings() {
  return `
    ${renderHeader("Hafıza Bağlantısı", "Private GitHub hafıza reposu bilgilerini gir.")}
    <section class="panel">
      <form class="connection-form" id="settings-form">
        <label>
          Repo
          <input name="repoInput" placeholder="cagrisahin58/work-memory veya GitHub URL" value="${escapeHtml(state.config.owner && state.config.repo ? `${state.config.owner}/${state.config.repo}` : "")}" />
        </label>
        <label>
          Branch
          <input name="branch" placeholder="main" value="${escapeHtml(state.config.branch || "main")}" />
        </label>
        <label class="full">
          GitHub Token
          <input name="token" type="password" placeholder="Fine-grained token, Contents read/write" value="${escapeHtml(state.config.token || "")}" />
        </label>
        <div class="toolbar-actions full">
          <button class="primary" type="submit">Bağlantıyı Kaydet</button>
          <button type="button" data-action="diagnose-repo" ${state.diagnosticsLoading ? "disabled" : ""}>${state.diagnosticsLoading ? "Tanılanıyor" : "Bağlantıyı Tanıla"}</button>
          <button type="button" data-action="init-repo">Repo Yapısını Hazırla</button>
          <button type="button" data-action="sync">Kaydetmeden Yenile</button>
        </div>
      </form>
    </section>
    ${renderDiagnostics()}
  `;
}

function renderDiagnostics() {
  if (!state.diagnostics) return "";
  const items = [
    state.diagnostics.repo,
    state.diagnostics.branch,
    state.diagnostics.configFile,
    ...state.diagnostics.directories,
    state.diagnostics.writeAccess
  ].filter(Boolean);
  return `
    <section class="panel">
      <h3>Bağlantı Tanılaması</h3>
      <div class="diagnostic-list">
        ${items.map(renderDiagnosticItem).join("")}
      </div>
    </section>
  `;
}

function renderDiagnosticItem(item) {
  const detail = item.ok ? diagnosticDetail(item.detail) : item.message;
  return `
    <div class="diagnostic-item ${item.ok ? "ok" : "fail"}">
      <span class="badge ${item.ok ? "active" : "blocked"}">${item.ok ? "Tamam" : "Uyarı"}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(detail || "")}</span>
    </div>
  `;
}

function diagnosticDetail(detail = {}) {
  if ("private" in detail) {
    const write = detail.writeHint === null ? "yazma izni belirsiz" : detail.writeHint ? "yazma izni görünüyor" : "yazma izni görünmüyor";
    return `${detail.private ? "private" : "public"}, varsayılan branch: ${detail.defaultBranch || "belirsiz"}, ${write}`;
  }
  if ("files" in detail) return `${detail.files} dosya`;
  if (detail.path) return detail.path;
  if (detail.sha) return `sha: ${detail.sha}`;
  if (detail.name) return detail.name;
  return "";
}

function renderRunner() {
  const { health, projects, error, loading } = state.runner;
  const codex = health?.codex || {};
  return `
    ${renderHeader(
      "Yerel Codex Runner",
      "Codex CLI, yerel hafıza mirror'ı ve kayıtlı proje kökleri buradan yönetilir.",
      `<button data-action="refresh-runner" ${loading ? "disabled" : ""}>${loading ? "Yenileniyor" : "Durumu Yenile"}</button>`
    )}
    <div class="runner-grid">
      <section class="panel">
        <h3>Runner Durumu</h3>
        <div class="diagnostic-list">
          <div class="diagnostic-item ${health ? "ok" : "fail"}">
            <span class="badge ${health ? "active" : "blocked"}">${health ? "Çevrim İçi" : "Kapalı"}</span>
            <strong>Servis</strong>
            <span>${health ? escapeHtml(`${health.service} ${health.version}`) : escapeHtml(error || "Henüz kontrol edilmedi.")}</span>
          </div>
          <div class="diagnostic-item ${codex.available ? "ok" : "fail"}">
            <span class="badge ${codex.available ? "active" : "blocked"}">${codex.available ? "Hazır" : "Eksik"}</span>
            <strong>Codex CLI</strong>
            <span>${codex.available ? escapeHtml(`${codex.command} · ${codex.version}`) : escapeHtml(codex.error || "Codex durumu bilinmiyor.")}</span>
          </div>
          ${health ? `
            <div class="diagnostic-item ok">
              <span class="badge active">Tamam</span>
              <strong>Yerel Hafıza</strong>
              <span>${escapeHtml(health.appDataDir)}</span>
            </div>
          ` : ""}
        </div>
      </section>
      <section class="panel">
        <h3>Proje Kökü Ekle</h3>
        <form class="connection-form" id="runner-project-form">
          <label>
            Proje Adı
            <input name="name" required placeholder="ctx-lab" />
          </label>
          <label>
            Branch
            <input name="branch" placeholder="main" value="main" />
          </label>
          <label>
            Repo
            <input name="repo" placeholder="cagrisahin58/ctx-lab" />
          </label>
          <label>
            Yerel Klasör
            <input name="path" data-project-path required placeholder="C:\\Users\\cagri\\projects\\projeler\\ai_hooks" />
          </label>
          <div class="toolbar-actions full">
            <button type="button" data-action="select-project-root">Klasör Seç</button>
            <button class="primary" type="submit">Proje Kökünü Kaydet</button>
          </div>
        </form>
      </section>
    </div>
    ${renderMemoryMirrorPanel()}
    <section class="panel">
      <h3>Kayıtlı Proje Kökleri</h3>
      <div class="record-list">
        ${projects.length ? projects.map(renderRunnerProject).join("") : `<div class="empty">Kayıtlı proje kökü yok. Codex otomasyonu başlamadan önce çalışılacak repo klasörü buraya eklenir.</div>`}
      </div>
    </section>
  `;
}

function renderMemoryMirrorPanel() {
  const memory = state.runner.memory;
  const config = memoryMirrorConfig();
  const hasConfig = Boolean(config);
  const statusText = !hasConfig
    ? "Hafıza repo bilgisi kaydedilmedi."
    : memory?.indexed
      ? `${memory.recordCount} kayıt indekslendi · ${formatDate(memory.lastIndexedAt)}`
      : memory?.cloneExists
        ? "Mirror var, index bekliyor."
        : memory?.error || "Yerel mirror henüz oluşturulmadı.";
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h3>Yerel Memory Mirror</h3>
          <p>GitHub kaynak gerçekliktir; bu mirror hızlı açılış, fark görünürlüğü ve masaüstü index için kullanılır.</p>
        </div>
        <button class="primary" data-action="sync-memory-mirror" ${hasConfig ? "" : "disabled"}>Mirror Yenile</button>
      </div>
      <div class="diagnostic-list">
        <div class="diagnostic-item ${memory?.indexed ? "ok" : "fail"}">
          <span class="badge ${memory?.indexed ? "active" : "waiting"}">${memory?.indexed ? "Hazır" : "Bekliyor"}</span>
          <strong>Index</strong>
          <span>${escapeHtml(statusText)}</span>
        </div>
        ${memory?.cloneDir ? `
          <div class="diagnostic-item ok">
            <span class="badge active">Klasör</span>
            <strong>Mirror</strong>
            <span>${escapeHtml(memory.cloneDir)}</span>
          </div>
        ` : ""}
        ${memory?.lastCommit ? `
          <div class="diagnostic-item ok">
            <span class="badge active">Commit</span>
            <strong>Son commit</strong>
            <span>${escapeHtml(memory.lastCommit)}</span>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderRunnerProject(project) {
  return `
    <article class="record-card runner-project">
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.path)}</p>
      <div class="meta">
        ${project.repo ? `<span>${escapeHtml(project.repo)}</span>` : ""}
        <span>${escapeHtml(project.branch || "main")}</span>
        ${project.updatedAt ? `<span>Güncellendi: ${escapeHtml(new Date(project.updatedAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }))}</span>` : ""}
      </div>
    </article>
  `;
}

function renderRecordCard(record) {
  return `
    <button class="record-card ${state.selectedId === record.id ? "selected" : ""}" data-select="${record.id}">
      <h3>${escapeHtml(record.title)}</h3>
      <p>${escapeHtml(record.summary || "Özet yok.")}</p>
      <div class="meta">
        <span class="badge ${record.status}">${statusLabel(record.status)}</span>
        ${record.source ? `<span>${escapeHtml(record.source)}</span>` : ""}
        ${record.project ? `<span>${escapeHtml(record.project)}</span>` : ""}
      </div>
    </button>
  `;
}

function renderRecordDetail(record, withActions) {
  const workItems = recordsByType("work_items");
  return `
    <h3>${escapeHtml(record.title)}</h3>
    <div class="meta">
      <span class="badge ${record.status}">${statusLabel(record.status)}</span>
      <span>${escapeHtml(record.path)}</span>
      ${record.repo ? `<span>${escapeHtml(record.repo)}</span>` : ""}
    </div>
    ${withActions ? `
      <div class="toolbar-actions">
        <button class="primary" data-action="create-work">Yeni/Proje İş Kartına Bağla</button>
        <button data-action="save-decision">Karar Çıkar</button>
        <button data-action="archive">Arşivle</button>
      </div>
      ${workItems.length ? `
        <div class="triage-linker">
          <select data-link-work-target aria-label="Mevcut iş kartı">
            ${workItems.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("")}
          </select>
          <button data-action="link-existing-work">Seçili İşe Bağla</button>
        </div>
      ` : ""}
    ` : ""}
    ${detailSection("Amaç", getSection(record.sections, "goal") || getSection(record.sections, "objective"))}
    ${detailSection("Yapılanlar / Güncel Durum", getSection(record.sections, "happened") || getSection(record.sections, "current"))}
    ${detailSection("Kararlar", getSection(record.sections, "decisions"))}
    ${record.type === "decisions" ? detailSection("Gerekçe", getSection(record.sections, "rationale")) : ""}
    ${record.type === "decisions" ? detailSection("Etki", getSection(record.sections, "impact")) : ""}
    ${record.type === "decisions" ? detailSection("Kaynak", getSection(record.sections, "source_section")) : ""}
    ${detailSection("Açık Sorular / Riskler", getSection(record.sections, "questions") || getSection(record.sections, "risks"))}
    ${detailSection("Sonraki Adımlar", getSection(record.sections, "next"))}
  `;
}

function detailSection(title, value) {
  if (!value) return "";
  return `
    <div class="section">
      <h4>${title}</h4>
      <pre>${escapeHtml(value)}</pre>
    </div>
  `;
}

function statusLabel(status) {
  return {
    needs_triage: "İşleme Bekliyor",
    linked: "Bağlandı",
    active: "Aktif",
    waiting: "Beklemede",
    blocked: "Engelli",
    done: "Tamamlandı",
    archived: "Arşiv"
  }[status] || status || "Durum yok";
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.select;
      render();
    });
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset));
  });
  document.querySelectorAll("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.recordId) state.selectedId = button.dataset.recordId;
      render();
    });
  });
  document.querySelectorAll("[data-search]").forEach((input) => {
    input.addEventListener("input", () => {
      setQuery(input.value);
    });
  });
  document.querySelectorAll("[data-status-select]").forEach((select) => {
    select.addEventListener("change", () => handleAction("update-work-status", {
      id: select.dataset.workId,
      status: select.value
    }));
  });
  document.querySelectorAll("[data-inbox-status]").forEach((select) => {
    select.addEventListener("change", () => {
      state.inboxStatus = select.value;
      keepSelectionVisible();
      render();
    });
  });
  document.querySelectorAll("[data-handoff-record]").forEach((select) => {
    select.addEventListener("change", () => {
      state.selectedId = select.value;
      render();
    });
  });
  document.querySelectorAll("[data-handoff-target]").forEach((select) => {
    select.addEventListener("change", () => {
      state.handoffTarget = select.value;
      render();
    });
  });
  const form = document.querySelector("#settings-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const data = new FormData(form);
        const repoParts = parseRepoInput(data.get("repoInput"));
        saveConfig({
          ...repoParts,
          branch: data.get("branch") || "main",
          token: data.get("token") || ""
        });
        setToast("Repo bağlantısı kaydedildi.");
        syncFromGitHub();
      } catch (error) {
        setToast(error.message);
      }
    });
  }
  const onboardingConfigForm = document.querySelector("#onboarding-config-form");
  if (onboardingConfigForm) {
    onboardingConfigForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("save-onboarding-config", onboardingConfigForm);
    });
  }
  const summaryForm = document.querySelector("#summary-form");
  if (summaryForm) {
    summaryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("create-summary", summaryForm);
    });
  }
  const workForm = document.querySelector("#work-form");
  if (workForm) {
    workForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("create-manual-work", workForm);
    });
  }
  const decisionForm = document.querySelector("#decision-form");
  if (decisionForm) {
    decisionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("create-manual-decision", decisionForm);
    });
  }
  const runnerProjectForm = document.querySelector("#runner-project-form");
  if (runnerProjectForm) {
    runnerProjectForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("register-runner-project", runnerProjectForm);
    });
  }
  const onboardingProjectForm = document.querySelector("#onboarding-project-form");
  if (onboardingProjectForm) {
    onboardingProjectForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("register-runner-project", onboardingProjectForm);
    });
  }
  const codexRunForm = document.querySelector("#codex-run-form");
  if (codexRunForm) {
    codexRunForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("start-codex-run", codexRunForm);
    });
  }
  document.querySelectorAll("[data-next-action-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      handleAction("update-work-next", {
        id: form.dataset.workId,
        nextAction: data.get("next_action")
      });
    });
  });
}

function handleAction(action, payload) {
  const guarded = async (fn) => {
    try {
      await fn();
      render();
    } catch (error) {
      setToast(error.message);
    }
  };

  if (action === "sync") guarded(syncFromGitHub);
  if (action === "init-repo") guarded(initializeMemoryRepo);
  if (action === "diagnose-repo") guarded(runDiagnostics);
  if (action === "refresh-runner") guarded(refreshRunnerStatus);
  if (action === "save-onboarding-config") guarded(() => saveOnboardingConfigFromForm(payload));
  if (action === "register-runner-project") guarded(() => registerProjectFromForm(payload));
  if (action === "select-project-root") guarded(selectProjectRootForForm);
  if (action === "start-codex-run") guarded(() => startCodexRunFromForm(payload));
  if (action === "sync-memory-mirror") guarded(syncMemoryMirrorFromConfig);
  if (action === "generate-onboarding-brief") {
    generateOnboardingBrief();
    render();
  }
  if (action === "finish-onboarding") finishOnboarding();
  if (action === "select-project") {
    state.selectedProject = payload?.project || "";
    state.view = "workspace";
    render();
  }
  if (action === "demo") loadDemo();
  if (action === "clear-search") {
    state.query = "";
    render();
  }
  if (action === "create-summary") guarded(() => createInboxSummaryFromForm(payload));
  if (action === "create-manual-work") guarded(() => createManualWorkFromForm(payload));
  if (action === "create-manual-decision") guarded(() => createManualDecisionFromForm(payload));
  if (action === "copy-close-prompt") guarded(copyClosePrompt);
  if (action === "copy-context-pack") guarded(copyContextPack);
  if (action === "copy-daily-brief") guarded(copyDailyBrief);
  if (action === "save-daily-brief") guarded(saveDailyBrief);
  if (action === "create-work") guarded(createWorkFromSelected);
  if (action === "link-existing-work") {
    const target = document.querySelector("[data-link-work-target]")?.value || "";
    guarded(() => createWorkFromSelected(target));
  }
  if (action === "update-work-status") guarded(() => updateSelectedWorkStatus(payload));
  if (action === "update-work-next") guarded(() => updateSelectedWorkNextAction(payload));
  if (action === "archive") guarded(archiveSelected);
  if (action === "save-decision") guarded(saveDecisionFromSelected);
  if (action === "save-handoff-current") guarded(() => saveHandoff(state.handoffTarget));
  if (action === "save-handoff-codex") guarded(() => saveHandoff("codex"));
  if (action === "save-handoff-claude") guarded(() => saveHandoff("claude"));
  if (action === "copy-handoff") {
    guarded(() => copyContextPack(state.handoffTarget));
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

refreshWarnings();
render();
refreshRunnerStatus({ silent: true });
