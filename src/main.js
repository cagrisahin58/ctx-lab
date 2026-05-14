import "./styles.css";
import {
  appendDecisionToWorkItem,
  appendCodexRunToWorkItem,
  appendSessionToWorkItem,
  buildArchivedRecordContent,
  buildCodexRunMemoryRecord,
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
  dismissTriageSuggestionContent,
  filterRecords,
  findWorkItemForSession,
  getSection,
  groupByStatus,
  parseRepoInput,
  isOnboardingComplete,
  parseMemoryFile,
  replaceFrontmatter,
  suggestWorkItemForSession,
  updateWorkItemNextActionContent,
  updateWorkItemStatusContent,
  upsertRecord,
  WORK_STATUSES,
  validateMemoryRecords
} from "./domain.js";
import { deleteFile, diagnoseMemoryRepo, ensureMemoryRepo, getBranchHead, loadMemoryRepo, putFile } from "./github.js";
import { demoRecords } from "./fixtures.js";
import {
  fetchRunnerHealth,
  fetchMemoryMirrorIndex,
  fetchRunnerProjects,
  fetchRunnerRuns,
  fetchMemoryMirrorStatus,
  registerRunnerProject,
  selectRunnerProjectDirectory,
  syncMemoryMirror,
  startRunnerCodexRun
} from "./runner-client.js";
import { loadAppConfig, loadRecordCache, loadTheme, saveAppConfig, saveRecordCache, saveTheme } from "./storage.js";

const app = document.querySelector("#app");
const initialConfig = loadAppConfig();
const initialCache = loadRecordCache(initialConfig);
const initialTheme = loadTheme();
const needsInitialOnboarding = !initialConfig.owner || !initialConfig.repo || !initialConfig.token;
document.documentElement.dataset.theme = initialTheme;

const state = {
  view: needsInitialOnboarding ? "onboarding" : "workspace",
  config: initialConfig,
  theme: initialTheme,
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
  commandPalette: {
    open: false,
    query: "",
    mode: "commands"
  },
  inboxStatus: "needs_triage",
  handoffTarget: "codex",
  onboardingBrief: "",
  tokenVisible: false,
  diagnostics: null,
  diagnosticsLoading: false,
  repoConflict: null,
  runner: {
    loading: false,
    health: null,
    projects: [],
    runs: [],
    memory: null,
    memoryIndex: null,
    error: ""
  },
  cacheMeta: {
    scope: initialCache.scope,
    syncedAt: initialCache.syncedAt,
    remoteHead: initialCache.remoteHead
  }
};

let keyPrefix = "";
let keyPrefixTimer = 0;

function saveConfig(config) {
  state.config = saveAppConfig(config);
  const cache = loadRecordCache(state.config);
  state.records = cache.records;
  state.cacheMeta = {
    scope: cache.scope,
    syncedAt: cache.syncedAt,
    remoteHead: cache.remoteHead
  };
  state.selectedId = state.records[0]?.id || "";
  state.selectedProject = "";
  state.demo = false;
  state.diagnostics = null;
  state.repoConflict = null;
  refreshWarnings();
}

function persistRecordCache() {
  if (state.demo) return;
  try {
    const cache = saveRecordCache(state.config, state.records, localStorage, new Date(), {
      remoteHead: state.cacheMeta.remoteHead
    });
    state.cacheMeta = {
      scope: cache.scope,
      syncedAt: cache.syncedAt,
      remoteHead: cache.remoteHead
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

function toggleTheme() {
  state.theme = saveTheme(state.theme === "dark" ? "light" : "dark");
  document.documentElement.dataset.theme = state.theme;
  addActivity(state.theme === "dark" ? "Koyu tema seçildi." : "Açık tema seçildi.", "info");
  render();
}

function toggleTokenVisibility() {
  state.tokenVisible = !state.tokenVisible;
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
    await assertRemoteHeadFresh();
    const result = await putFile(state.config, path, content, message, existing?.sha);
    sha = result?.content?.sha || sha;
    rememberRemoteHead(result?.commit?.sha || state.cacheMeta.remoteHead || "");
  }
  const parsed = parseMemoryFile(path, content, sha);
  state.records = upsertRecord(state.records, parsed);
  refreshWarnings();
  persistRecordCache();
  return parsed;
}

async function assertRemoteHeadFresh() {
  if (state.demo || !state.config.owner || !state.config.repo || !state.cacheMeta.remoteHead) return;
  const latestHead = await getBranchHead(state.config);
  if (!latestHead || latestHead === state.cacheMeta.remoteHead) return;
  state.repoConflict = {
    previous: state.cacheMeta.remoteHead,
    current: latestHead,
    detectedAt: new Date().toISOString()
  };
  addActivity("GitHub hafıza reposu dışarıdan güncellendi.", "warning", "Yazmadan önce GitHub'dan Yenile.");
  render();
  throw new Error("GitHub hafıza reposu dışarıdan güncellendi. Yazmadan önce GitHub'dan Yenile.");
}

function rememberRemoteHead(remoteHead) {
  if (!remoteHead) return;
  state.cacheMeta = {
    ...state.cacheMeta,
    remoteHead
  };
  state.repoConflict = null;
}

async function syncFromGitHub() {
  if (!state.config.owner || !state.config.repo) {
    setToast("Önce GitHub hafıza bağlantısını kaydet.");
    return;
  }
  state.loading = true;
  render();
  try {
    state.demo = false;
    state.records = await loadMemoryRepo(state.config);
    rememberRemoteHead(await getBranchHead(state.config));
    refreshWarnings();
    persistRecordCache();
    state.selectedId = state.records[0]?.id || "";
    setToast(state.warnings.length ? "Hafıza reposu yüklendi; format uyarıları var." : "Hafıza reposu senkronize edildi.");
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

async function dismissTriageSuggestion(workItemId) {
  const record = selectedRecord();
  if (!record || record.type !== "inbox" || !workItemId) return;
  const updated = dismissTriageSuggestionContent(record, workItemId);
  const parsed = await saveMemoryRecord(record.path, updated, `inbox: ${record.id} akıllı eşleşme reddedildi`);
  state.selectedId = parsed.id;
  setToast("Akıllı eşleşme önerisi reddedildi.");
}

async function archiveSelected() {
  const record = selectedRecord();
  if (!record || record.type !== "inbox") return;
  const fileName = record.path.split("/").pop();
  const archivePath = `archive/${fileName}`;
  const archivedContent = buildArchivedRecordContent(record);
  const parsed = await saveMemoryRecord(archivePath, archivedContent, `archive: ${record.id}`);
  if (!state.demo) {
    const result = await deleteFile(state.config, record.path, record.sha, `archive: ${record.id} kaynak inbox kaydını sil`);
    rememberRemoteHead(result?.commit?.sha || state.cacheMeta.remoteHead || "");
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

async function moveWorkItemToStatus(workItemId, status) {
  const record = state.records.find((item) => item.id === workItemId);
  if (!record || record.type !== "work_items") {
    setToast("Taşınacak iş kartı bulunamadı.");
    return;
  }
  if (record.status === status) {
    state.selectedId = record.id;
    render();
    return;
  }
  await updateSelectedWorkStatus({ id: workItemId, status });
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
    setToast("Önce hafıza bağlantısını kaydet.");
    return;
  }
  const created = await ensureMemoryRepo(state.config);
  setToast(created.length ? `Hafıza reposu hazırlandı: ${created.length} dosya oluşturuldu.` : "Hafıza reposu yapısı zaten hazır.");
  await syncFromGitHub();
}

async function runDiagnostics() {
  if (!state.config.owner || !state.config.repo) {
    setToast("Önce hafıza bağlantısını kaydet.");
    return;
  }
  state.diagnosticsLoading = true;
  render();
  try {
    state.diagnostics = await diagnoseMemoryRepo(state.config);
    setToast(state.diagnostics.ok ? "Hafıza tanılaması temiz." : "Hafıza tanılamasında uyarılar var.");
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
    const memoryIndex = memoryConfig && memory?.indexed
      ? await fetchMemoryMirrorIndex(memoryConfig).catch((error) => ({
        error: error.message,
        records: []
      }))
      : null;
    state.runner = {
      loading: false,
      health,
      projects: Array.isArray(registry.projects) ? registry.projects : [],
      runs: Array.isArray(runsPayload.runs) ? runsPayload.runs : [],
      memory,
      memoryIndex,
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
  const result = await registerRunnerProject({
    name: data.get("name"),
    path: data.get("path"),
    repo: data.get("repo"),
    branch: data.get("branch") || "main"
  });
  if (Array.isArray(result.registry?.projects)) {
    state.runner.projects = result.registry.projects;
  }
  setToast("Proje kökü yerel runner'a kaydedildi.");
  form.reset();
  refreshRunnerStatus({ silent: true });
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
  const sourceRecord = contextRecord();
  const sourceWorkItem = sourceRecord?.type === "work_items"
    ? sourceRecord
    : state.records.find((record) => record.type === "work_items" && record.id === sourceRecord?.linkedWorkItem);
  const run = await startRunnerCodexRun({
    projectId,
    automationLevel: data.get("automationLevel"),
    template: data.get("template"),
    prompt: data.get("prompt"),
    dryRun: data.get("dryRun") === "on",
    confirmCommitPush: data.get("confirmCommitPush") === "on",
    sourceRecordId: sourceRecord?.id || "",
    sourceRecordPath: sourceRecord?.path || "",
    sourceWorkItemId: sourceWorkItem?.id || ""
  });
  state.runner.runs = [run, ...state.runner.runs.filter((item) => item.id !== run.id)].slice(0, 20);
  if (data.get("linkMemory") === "on") {
    await persistCodexRunMemoryLink(run, sourceRecord, sourceWorkItem);
  }
  addActivity(`Codex run kaydı: ${run.id}`, run.status === "failed" ? "error" : "success", run.summary || run.error || "");
  setToast(run.status === "dry_run" ? "Codex dry-run kaydı hazırlandı." : "Codex run tamamlandı.", run.status === "failed" ? "error" : "success");
  form.reset();
  const dryRun = form.querySelector("input[name='dryRun']");
  if (dryRun) dryRun.checked = true;
}

async function persistCodexRunMemoryLink(run, sourceRecord, sourceWorkItem) {
  if (!sourceRecord) return;
  if (!state.demo && (!state.config.owner || !state.config.repo)) {
    addActivity("Codex run hafıza kaydına bağlanamadı.", "warning", "Hafıza bağlantısı yok.");
    return;
  }
  const runMemory = buildCodexRunMemoryRecord(run, sourceRecord);
  const savedRun = await saveMemoryRecord(runMemory.path, runMemory.content, `codex run: ${run.id} sonucunu kaydet`);
  if (sourceWorkItem) {
    const latestWorkItem = state.records.find((record) => record.id === sourceWorkItem.id) || sourceWorkItem;
    const updatedWork = appendCodexRunToWorkItem(latestWorkItem, savedRun);
    const parsedWork = await saveMemoryRecord(latestWorkItem.path, updatedWork, `work: ${latestWorkItem.id} codex run bağlantısını güncelle`);
    state.selectedId = parsedWork.id;
  } else {
    state.selectedId = savedRun.id;
  }
  addActivity(`Codex run hafıza kaydına bağlandı: ${savedRun.id}`, "success");
}

async function syncMemoryMirrorFromConfig() {
  const config = memoryMirrorConfig();
  if (!config) {
    setToast("Önce Hafıza Bağlantısı ekranında GitHub hafıza reposu bilgisini kaydet.");
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
  state.runner.memoryIndex = index;
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
    setToast("Önce GitHub hafıza bağlantısını kaydet.");
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
    setToast("Önce GitHub hafıza bağlantısını kaydet.");
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
    setToast("Önce GitHub hafıza bağlantısını kaydet.");
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
        <button class="command-trigger" data-action="open-command-palette">
          <span>Komut Paleti</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button class="theme-toggle" data-action="toggle-theme">
          <span>Tema</span>
          <strong>${state.theme === "dark" ? "Koyu" : "Açık"}</strong>
        </button>
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
        ${renderRepoConflictBanner()}
        ${renderCurrentView(counts)}
      </main>
      ${renderCommandPalette()}
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
    : "Hafıza reposu bağlı değil";
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
  const busy = state.loading || state.runner.loading;
  const memoryStatus = state.demo ? "Örnek veri" : (state.cacheMeta.syncedAt ? "Yerel cache hazır" : "Yerel cache yok");
  const githubStatus = state.config.owner && state.config.repo ? "GitHub bağlı" : "GitHub bekliyor";
  const codexStatus = codex?.available ? `Codex ${codex.version}` : (state.runner.error || "Codex kontrol bekliyor");
  const mirror = state.runner.memory;
  const mirrorStatus = mirror?.indexed ? `Mirror index: ${mirror.recordCount} kayıt` : (mirror?.error || "Mirror bekliyor");
  const healthStatus = state.warnings.length ? `Hafıza sağlığı: ${state.warnings.length} uyarı` : "Hafıza sağlığı temiz";
  return `
    <div class="status-bar ${busy ? "is-syncing" : ""}">
      <span class="status-dot ok"></span><span>${escapeHtml(githubStatus)}</span>
      <span class="status-dot ${state.cacheMeta.syncedAt || state.demo ? "ok" : "warn"}"></span><span>${escapeHtml(memoryStatus)}</span>
      <span class="status-dot ${mirror?.indexed ? "ok" : "warn"}"></span><span>${escapeHtml(mirrorStatus)}</span>
      <span class="status-dot ${state.warnings.length ? "warn" : "ok"}"></span><span>${escapeHtml(healthStatus)}</span>
      <span class="status-dot ${codex?.available ? "ok" : "warn"}"></span><span>${escapeHtml(codexStatus)}</span>
      <button class="ghost compact" data-action="refresh-runner">Runner</button>
    </div>
  `;
}

function renderRepoConflictBanner() {
  if (!state.repoConflict) return "";
  const previous = state.repoConflict.previous ? state.repoConflict.previous.slice(0, 7) : "bilinmiyor";
  const current = state.repoConflict.current ? state.repoConflict.current.slice(0, 7) : "bilinmiyor";
  return `
    <section class="repo-conflict-banner">
      <div>
        <strong>GitHub hafıza reposu dışarıdan güncellendi.</strong>
        <p>Yerel kayıtlar eski olabilir. Yazmadan önce yenile: ${escapeHtml(previous)} → ${escapeHtml(current)}</p>
      </div>
      <button class="primary" data-action="sync">GitHub'dan Yenile</button>
    </section>
  `;
}

function renderCommandPalette() {
  if (!state.commandPalette.open) return "";
  const query = state.commandPalette.query.trim();
  const mode = state.commandPalette.mode;
  const commands = filteredCommandItems(query);
  return `
    <div class="command-backdrop" data-action="close-command-palette">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="${mode === "shortcuts" ? "Kısayollar" : "Komut Paleti"}" data-command-dialog>
        <div class="command-head">
          <div>
            <strong>${mode === "shortcuts" ? "Kısayollar" : "Komut Paleti"}</strong>
            <span>${mode === "shortcuts" ? "Hızlı gezinme ve üretim aksiyonları" : "Görünümler, kayıtlar ve runner aksiyonları"}</span>
          </div>
          <button class="ghost compact" data-action="close-command-palette">Esc</button>
        </div>
        ${mode === "shortcuts" ? renderShortcutSheet() : `
          <input data-command-search aria-label="Komut ara" placeholder="Komut, görünüm veya proje ara" value="${escapeHtml(state.commandPalette.query)}" />
          <div class="command-list">
            ${commands.length ? commands.map((command, index) => `
              <button class="command-item ${index === 0 ? "active" : ""}" data-command-id="${escapeHtml(command.id)}">
                <span>
                  <strong>${escapeHtml(command.title)}</strong>
                  <small>${escapeHtml(command.subtitle || "")}</small>
                </span>
                ${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ""}
              </button>
            `).join("") : `<div class="empty">Eşleşen komut yok.</div>`}
          </div>
        `}
      </section>
    </div>
  `;
}

function renderShortcutSheet() {
  return `
    <div class="shortcut-grid">
      ${shortcutRows().map((row) => `
        <div class="shortcut-row">
          <kbd>${escapeHtml(row.keys)}</kbd>
          <span>${escapeHtml(row.label)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function shortcutRows() {
  return [
    { keys: "Ctrl K", label: "Komut paleti" },
    { keys: "?", label: "Kısayollar" },
    { keys: "g i", label: "Oturum Akışı" },
    { keys: "g b", label: "İş Akışı" },
    { keys: "g d", label: "Karar Defteri" },
    { keys: "g h", label: "Devam Brifi" },
    { keys: "n s", label: "Yeni Oturum Özeti" },
    { keys: "n w", label: "Yeni İş Hattı" },
    { keys: "n d", label: "Yeni Karar" },
    { keys: "s", label: "GitHub'dan Yenile" },
    { keys: "/", label: "Aramayı odakla" },
    { keys: "Esc", label: "Paneli kapat" }
  ];
}

function commandItems() {
  const projectCommands = projectSummaries().map((project) => ({
    id: `project:${project.name}`,
    title: project.name,
    subtitle: project.repo || project.localPath || "Proje çalışma merkezi",
    keywords: `proje ${project.name} ${project.repo || ""}`,
    run: () => {
      state.selectedProject = project.name;
      setView("workspace");
    }
  }));
  return [
    { id: "view:workspace", title: "Proje Çalışma Merkezi", subtitle: "Timeline ve güncel bağlam", shortcut: "g p", keywords: "proje calisma merkezi timeline", run: () => setView("workspace") },
    { id: "view:inbox", title: "Oturum Akışı", subtitle: "İşleme bekleyen oturum özetleri", shortcut: "g i", keywords: "inbox oturum akis triage", run: () => setView("inbox") },
    { id: "view:board", title: "İş Akışı", subtitle: "Aktif, bekleyen ve engelli iş hatları", shortcut: "g b", keywords: "board is akisi pano", run: () => setView("board") },
    { id: "view:decisions", title: "Karar Defteri", subtitle: "Kaynaklı karar kayıtları", shortcut: "g d", keywords: "karar decision", run: () => setView("decisions") },
    { id: "view:handoff", title: "Devam Brifi", subtitle: "Codex veya Claude için bağlam paketi", shortcut: "g h", keywords: "handoff baglam paketi devam brifi", run: () => setView("handoff") },
    { id: "view:daily", title: "Günlük Devam Brifi", subtitle: "Açık işlerden günlük çalışma metni", keywords: "gunluk brif", run: () => setView("daily") },
    { id: "view:runner", title: "Yerel Codex Runner", subtitle: "CLI, proje kökleri ve run kayıtları", keywords: "codex runner otomasyon", run: () => setView("runner") },
    { id: "view:settings", title: "Hafıza Bağlantısı", subtitle: "GitHub hafıza reposu ayarları", keywords: "repo baglanti github hafiza", run: () => setView("settings") },
    { id: "view:health", title: "Hafıza Sağlığı", subtitle: state.warnings.length ? `${state.warnings.length} format uyarısı` : "Format uyarısı yok", keywords: "hafiza saglik validation uyarı duplicate status", run: () => setView("settings") },
    { id: "new:summary", title: "Yeni Oturum Özeti", subtitle: "Yeni kapanan AI oturumunu kaydet", shortcut: "n s", keywords: "yeni ozet session", run: () => setView("new-summary") },
    { id: "new:work", title: "Yeni İş Hattı", subtitle: "Bağımsız iş hattı oluştur", shortcut: "n w", keywords: "yeni is hatti work", run: () => setView("new-work") },
    { id: "new:decision", title: "Yeni Karar", subtitle: "Kaynaklı karar kaydı oluştur", shortcut: "n d", keywords: "yeni karar decision", run: () => setView("new-decision") },
    { id: "action:sync", title: "GitHub'dan Yenile", subtitle: repoLabel(), shortcut: "s", keywords: "sync yenile github", run: () => handleAction("sync") },
    { id: "action:refresh-runner", title: "Runner Durumunu Yenile", subtitle: "Codex CLI ve proje kökleri", keywords: "runner refresh codex", run: () => handleAction("refresh-runner") },
    { id: "action:theme", title: "Temayı Değiştir", subtitle: state.theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç", keywords: "tema dark light acik koyu", run: () => handleAction("toggle-theme") },
    { id: "action:demo", title: "Örnek Verilerle Dene", subtitle: "Demo çalışma hafızası yükle", keywords: "demo ornek veri", run: () => handleAction("demo") },
    { id: "action:copy-context", title: "Devam Brifini Kopyala", subtitle: selectedProjectName() || "Seçili kayıt", keywords: "kopyala devam brifi context", run: () => handleAction("copy-context-pack") },
    { id: "help:shortcuts", title: "Kısayollar", subtitle: "Klavye akışını aç", shortcut: "?", keywords: "yardim kisayol shortcut", run: () => openCommandPalette("shortcuts") },
    ...projectCommands
  ];
}

function filteredCommandItems(query) {
  const items = commandItems();
  if (!query) return items.slice(0, 12);
  const normalized = normalizeCommandText(query);
  return items
    .map((item) => ({
      item,
      score: commandScore(item, normalized)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "tr"))
    .slice(0, 12)
    .map((entry) => entry.item);
}

function commandScore(command, query) {
  const haystack = normalizeCommandText(`${command.title} ${command.subtitle || ""} ${command.keywords || ""}`);
  if (haystack.includes(query)) return 100 - haystack.indexOf(query);
  let cursor = 0;
  let score = 0;
  for (const char of query) {
    const next = haystack.indexOf(char, cursor);
    if (next === -1) return 0;
    score += next === cursor ? 3 : 1;
    cursor = next + 1;
  }
  return score;
}

function normalizeCommandText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
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
  const evidenceRun = selectedRunForContext();
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
      <label class="check-row"><input type="checkbox" name="linkMemory" checked> Run sonucunu seçili iş hattına bağla</label>
      <label class="check-row caution"><input type="checkbox" name="confirmCommitPush"> Commit + push için ayrı onay verdim</label>
      <button class="primary" type="submit" ${projects.length ? "" : "disabled"}>Run kaydı oluştur</button>
      ${state.runner.runs.length ? `<div class="run-list">${state.runner.runs.slice(0, 4).map(renderRunMini).join("")}</div>` : ""}
      ${renderRunEvidence(evidenceRun)}
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
      <span>${escapeHtml(run.status)} · ${escapeHtml(run.automationLevel || "")}${run.sourceWorkItemId ? ` · ${escapeHtml(run.sourceWorkItemId)}` : ""}</span>
    </div>
  `;
}

function selectedRunForContext() {
  const workItem = selectedProjectWorkItem();
  const runs = selectedProjectRuns();
  if (!runs.length) return null;
  return runs.find((run) => workItem?.id && run.sourceWorkItemId === workItem.id) || runs[0];
}

function renderRunEvidence(run) {
  if (!run) {
    return `
      <div class="run-evidence empty-evidence">
        <h4>Run Kanıtı</h4>
        <p>Henüz Codex run kaydı yok. İlk dry-run sonrası log yolu, test sonucu ve çıktı özeti burada görünür.</p>
      </div>
    `;
  }
  const output = compactOutput(run.stdout || run.stderr || run.error || run.summary || "");
  return `
    <div class="run-evidence">
      <div class="run-evidence-head">
        <div>
          <h4>Run Kanıtı</h4>
          <p>${escapeHtml(run.id)}</p>
        </div>
        <span class="badge ${["failed", "blocked"].includes(run.status) ? "blocked" : "active"}">${escapeHtml(run.status || "durum yok")}</span>
      </div>
      <div class="run-evidence-grid">
        ${runFact("Otomasyon", automationLevelLabel(run.automationLevel))}
        ${runFact("Test sonucu", testResultLabel(run.testResult))}
        ${runFact("Exit code", run.exitCode ?? (run.dryRun ? "dry-run" : "yok"))}
        ${runFact("Git başlangıç", gitSnapshotLabel(run.gitBefore))}
        ${runFact("Git sonuç", gitSnapshotLabel(run.gitAfter))}
        ${runFact("Log", run.logPath || "log yolu yok")}
      </div>
      ${run.summary ? `<p class="run-summary">${escapeHtml(run.summary)}</p>` : ""}
      ${run.commitGate ? `<p class="run-gate">${escapeHtml(run.commitGate)}</p>` : ""}
      ${output ? `<pre>${escapeHtml(output)}</pre>` : ""}
    </div>
  `;
}

function runFact(label, value) {
  return `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`;
}

function automationLevelLabel(level) {
  return {
    brief: "Sadece brif",
    suggest: "Öneri",
    edit_no_commit: "Dosya değiştir, commit yok",
    test: "Test çalıştır",
    commit_prepare: "Commit hazırla",
    commit_push: "Commit + push"
  }[level] || level || "belirsiz";
}

function testResultLabel(result) {
  return {
    passed: "Başarılı sinyal",
    failed: "Hata sinyali",
    not_run: "Çalıştırılmadı",
    not_detected: "Net tespit yok"
  }[result] || "Net tespit yok";
}

function gitSnapshotLabel(snapshot) {
  if (!snapshot) return "kaydedilmedi";
  if (!snapshot.available) return snapshot.error || "git çalışma ağacı değil";
  const head = snapshot.head ? snapshot.head.slice(0, 8) : "head yok";
  const dirty = snapshot.dirty ? `${snapshot.changedCount || 0} değişiklik` : "temiz";
  return `${snapshot.branch || "branch yok"} @ ${head} · ${dirty}`;
}

function compactOutput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 900 ? `${text.slice(0, 900)}\n...` : text;
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
              <span class="secret-field">
                <input name="token" type="${state.tokenVisible ? "text" : "password"}" placeholder="Fine-grained token, Contents read/write" value="${escapeHtml(state.config.token || "")}" />
                <button type="button" data-action="toggle-token-visibility">${state.tokenVisible ? "Tokeni gizle" : "Tokeni göster"}</button>
              </span>
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

function renderMemoryHealthPanel() {
  const grouped = groupWarningsByRecord();
  return `
    <section class="panel memory-health" id="memory-health">
      <div class="panel-heading">
        <div>
          <h3>Hafıza Sağlığı</h3>
          <p>Duplicate id, eksik alan ve bilinmeyen status uyarıları burada izlenir.</p>
        </div>
        <span class="badge ${state.warnings.length ? "blocked" : "active"}">${state.warnings.length ? `${state.warnings.length} uyarı` : "Temiz"}</span>
      </div>
      ${state.warnings.length ? `
        <div class="health-list">
          ${grouped.map((item) => `
            <div class="health-item">
              <strong>${escapeHtml(item.path)}</strong>
              <ul>
                ${item.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}
              </ul>
            </div>
          `).join("")}
        </div>
      ` : `<div class="empty">Aktif memory kayıtlarında format uyarısı yok.</div>`}
    </section>
  `;
}

function groupWarningsByRecord() {
  const map = new Map();
  for (const warning of state.warnings) {
    const [path, ...rest] = warning.split(":");
    const message = rest.join(":").trim() || warning;
    if (!map.has(path)) map.set(path, []);
    map.get(path).push(message);
  }
  return [...map.entries()].map(([path, messages]) => ({ path, messages }));
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
          <section class="column" data-board-column="${status}">
            <div class="column-head">
              <h3>${title}${status === "blocked" ? " !" : ""}</h3>
              <span>${(groups[status] || []).length}</span>
            </div>
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
          <input name="title" required placeholder="Hafıza reposu kaynak olacak" />
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
  const metrics = selected ? handoffMetrics(selected, prompt) : null;
  return `
    ${renderHeader("Devam Brifi", "Seçili iş hattı veya oturum kaydından Codex/Claude devam brifi üret.")}
    <section class="panel detail handoff-studio">
      ${selected ? `
        <div class="handoff-hero">
          <div>
            <span class="eyebrow">Devam Brifi</span>
            <h3>${escapeHtml(selected.title)}</h3>
            <p>${escapeHtml(selected.repo || selected.project || selected.path)}</p>
          </div>
          <div class="target-switch" role="group" aria-label="Devam brifi hedefi">
            <button class="${state.handoffTarget === "codex" ? "active" : ""}" data-action="set-handoff-target" data-target="codex">Codex</button>
            <button class="${state.handoffTarget === "claude" ? "active claude" : "claude"}" data-action="set-handoff-target" data-target="claude">Claude Code</button>
          </div>
        </div>
        <div class="handoff-source-row">
          <label>
            Kaynak kayıt
            <select data-handoff-record aria-label="Devam brifi kaynak kaydı">
              ${records.map((record) => `<option value="${escapeHtml(record.id)}" ${selected.id === record.id ? "selected" : ""}>${escapeHtml(record.title)} · ${escapeHtml(record.type)}</option>`).join("")}
            </select>
          </label>
        </div>
        <section class="handoff-package">
          <h4>Paket İçeriği</h4>
          <div class="handoff-metrics" aria-label="Paket içeriği">
            ${metricCard("Oturum", metrics.sessions)}
            ${metricCard("Karar", metrics.decisions)}
            ${metricCard("Codex run", metrics.codexRuns)}
            ${metricCard("Tahmini token", metrics.tokens)}
          </div>
        </section>
        <div class="toolbar-actions">
          <button class="primary" data-action="save-handoff-current">Devam Brifini Kaydet</button>
          <button data-action="copy-handoff">Kopyala</button>
        </div>
        <div class="handoff-preview" aria-label="Devam brifi önizlemesi">
          ${renderMarkdownPreview(prompt)}
        </div>
      ` : `<div class="empty">Devam brifi üretmek için önce bir oturum kaydı veya iş hattı oluşturun.</div>`}
    </section>
  `;
}

function handoffMetrics(record, prompt) {
  const relatedWork = record.type === "work_items"
    ? record
    : state.records.find((item) => item.type === "work_items" && (
      item.id === record.linkedWorkItem ||
      arrayValue(item.frontmatter.sessions).includes(record.id)
    ));
  const sessions = record.type === "inbox"
    ? new Set([record.id, ...arrayValue(relatedWork?.frontmatter?.sessions)])
    : new Set(arrayValue(relatedWork?.frontmatter?.sessions || record.frontmatter.sessions));
  const decisions = new Set(arrayValue(relatedWork?.frontmatter?.decisions || record.frontmatter.decisions));
  if (record.type === "decisions") decisions.add(record.id);
  return {
    sessions: sessions.size,
    decisions: decisions.size,
    codexRuns: arrayValue(relatedWork?.frontmatter?.codex_runs || record.frontmatter.codex_runs).length,
    tokens: Math.max(1, Math.ceil(String(prompt || "").length / 4))
  };
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [String(value)].filter(Boolean);
}

function renderMarkdownPreview(markdown) {
  return String(markdown || "").split("\n").map((line) => {
    const trimmed = line.trim();
    let kind = "text";
    if (!trimmed) kind = "blank";
    else if (trimmed.startsWith("#")) kind = "heading";
    else if (/^[-*]\s+/.test(trimmed)) kind = "list";
    else if (/^\d+\.\s+/.test(trimmed)) kind = "list";
    else if (trimmed.startsWith(">")) kind = "quote";
    return `<div class="md-line ${kind}">${escapeHtml(line || " ")}</div>`;
  }).join("");
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
          <span class="secret-field">
            <input name="token" type="${state.tokenVisible ? "text" : "password"}" placeholder="Fine-grained token, Contents read/write" value="${escapeHtml(state.config.token || "")}" />
            <button type="button" data-action="toggle-token-visibility">${state.tokenVisible ? "Tokeni gizle" : "Tokeni göster"}</button>
          </span>
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
    ${renderMemoryHealthPanel()}
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
    ${renderMemorySyncPanel()}
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
    ? "Hafıza reposu bilgisi kaydedilmedi."
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

function renderMemorySyncPanel() {
  const snapshot = memorySyncSnapshot();
  return `
    <section class="panel memory-sync">
      <div class="panel-heading">
        <div>
          <h3>Hafıza Senkron Durumu</h3>
          <p>GitHub cache, yerel mirror ve index farkı burada görünür tutulur.</p>
        </div>
        <span class="badge ${snapshot.badge}">${escapeHtml(snapshot.label)}</span>
      </div>
      <div class="sync-state-grid">
        ${syncStateItem("Son GitHub senkronizasyonu", snapshot.cacheText, snapshot.cacheKind)}
        ${syncStateItem("Yerel mirror", snapshot.mirrorText, snapshot.mirrorKind)}
        ${syncStateItem("Karşılaştırma", snapshot.compareText, snapshot.compareKind)}
      </div>
      ${snapshot.details.length ? `
        <div class="sync-diff-list">
          ${snapshot.details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function syncStateItem(label, value, kind) {
  return `
    <div class="sync-state-item ${kind}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function memorySyncSnapshot() {
  const mirror = state.runner.memory;
  const index = state.runner.memoryIndex;
  const cacheTime = dateValue(state.cacheMeta.syncedAt);
  const mirrorTime = dateValue(mirror?.lastIndexedAt);
  const cacheText = state.cacheMeta.syncedAt
    ? `${state.records.length} kayıt · ${formatDate(state.cacheMeta.syncedAt)}`
    : "Yerel önbellek yok";
  const mirrorText = mirror?.indexed
    ? `${mirror.recordCount} kayıt · ${formatDate(mirror.lastIndexedAt)}`
    : mirror?.error || "Mirror bekliyor";
  const hasIndexRecords = Array.isArray(index?.records);
  const localByPath = new Map(state.records.map((record) => [record.path, recordSignature(record)]));
  const mirrorByPath = new Map(hasIndexRecords ? index.records.map((record) => [record.path, recordSignature(record)]) : []);
  let missingInMirror = 0;
  let missingInCache = 0;
  let changed = 0;

  if (hasIndexRecords) {
    for (const [path, signature] of localByPath) {
      if (!mirrorByPath.has(path)) missingInMirror += 1;
      else if (mirrorByPath.get(path) !== signature) changed += 1;
    }
    for (const path of mirrorByPath.keys()) {
      if (!localByPath.has(path)) missingInCache += 1;
    }
  }

  const diffCount = missingInMirror + missingInCache + changed;
  const cacheNewerThanMirror = cacheTime && mirrorTime && cacheTime > mirrorTime + 1000;
  const details = [];
  if (missingInMirror) details.push(`${missingInMirror} kayıt mirror içinde yok`);
  if (missingInCache) details.push(`${missingInCache} kayıt yerel cache içinde yok`);
  if (changed) details.push(`${changed} kayıt özeti farklı`);
  if (cacheNewerThanMirror) details.push("Yerel cache mirror indeksinden daha yeni");
  if (index?.warningCount || mirror?.warningCount) details.push(`${index?.warningCount || mirror.warningCount} format uyarısı`);

  if (state.demo) {
    return {
      label: "Örnek veri",
      badge: "waiting",
      cacheText: "Örnek veri modu",
      cacheKind: "waiting",
      mirrorText,
      mirrorKind: mirror?.indexed ? "ok" : "waiting",
      compareText: "Gerçek repo bağlanınca karşılaştırılır",
      compareKind: "waiting",
      details
    };
  }
  if (!state.cacheMeta.syncedAt) {
    return {
      label: "Yerel önbellek yok",
      badge: "blocked",
      cacheText,
      cacheKind: "fail",
      mirrorText,
      mirrorKind: mirror?.indexed ? "ok" : "waiting",
      compareText: "GitHub'dan yenileme bekleniyor",
      compareKind: "waiting",
      details
    };
  }
  if (!mirror?.indexed) {
    return {
      label: "Mirror bekliyor",
      badge: "waiting",
      cacheText,
      cacheKind: "ok",
      mirrorText,
      mirrorKind: "waiting",
      compareText: "Mirror yenilenmeden fark çıkarılamaz",
      compareKind: "waiting",
      details
    };
  }
  if (index?.error) {
    return {
      label: "Index okunamadı",
      badge: "blocked",
      cacheText,
      cacheKind: "ok",
      mirrorText,
      mirrorKind: "ok",
      compareText: index.error,
      compareKind: "fail",
      details
    };
  }
  if (hasIndexRecords && diffCount === 0 && !cacheNewerThanMirror) {
    return {
      label: "GitHub ile aynı",
      badge: "active",
      cacheText,
      cacheKind: "ok",
      mirrorText,
      mirrorKind: "ok",
      compareText: "Kayıt yolları ve özet alanları eşleşiyor",
      compareKind: "ok",
      details
    };
  }
  return {
    label: cacheNewerThanMirror ? "Yerel değişiklik var" : "Fark var",
    badge: "waiting",
    cacheText,
    cacheKind: "ok",
    mirrorText,
    mirrorKind: "ok",
    compareText: hasIndexRecords ? `${diffCount} fark` : "Index detayı bekleniyor",
    compareKind: "waiting",
    details
  };
}

function recordSignature(record = {}) {
  return [
    record.id || "",
    record.type || "",
    record.status || "",
    record.title || "",
    record.updatedAt || record.frontmatter?.updated_at || "",
    record.nextAction || ""
  ].join("|");
}

function dateValue(value) {
  const date = new Date(value || "");
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
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
  const dragAttrs = record.type === "work_items"
    ? ` draggable="true" data-drag-work-id="${escapeHtml(record.id)}"`
    : "";
  return `
    <button class="record-card ${state.selectedId === record.id ? "selected" : ""}" data-select="${record.id}"${dragAttrs}>
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
  const suggestion = withActions && record.type === "inbox"
    ? suggestWorkItemForSession(state.records, record)
    : null;
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
      ${suggestion ? renderTriageSuggestion(suggestion) : ""}
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

function renderTriageSuggestion(suggestion) {
  return `
    <div class="triage-suggestion">
      <div>
        <span class="badge active">Akıllı eşleşme</span>
        <strong>${escapeHtml(suggestion.workItem.title)}</strong>
        <p>Bu oturum muhtemelen bu iş hattına ait. Skor: ${suggestion.score}. ${escapeHtml(suggestion.reasons.join(", "))}</p>
      </div>
      <div class="toolbar-actions">
        <button class="primary" data-action="link-suggested-work" data-suggested-work-id="${escapeHtml(suggestion.workItem.id)}">Önerilen İşe Bağla</button>
        <button data-action="dismiss-triage-suggestion" data-suggested-work-id="${escapeHtml(suggestion.workItem.id)}">Reddet</button>
      </div>
    </div>
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

function openCommandPalette(mode = "commands") {
  state.commandPalette = {
    open: true,
    query: "",
    mode
  };
  render();
  const input = document.querySelector("[data-command-search]");
  if (input) input.focus();
}

function closeCommandPalette() {
  if (!state.commandPalette.open) return;
  state.commandPalette = {
    ...state.commandPalette,
    open: false,
    query: "",
    mode: "commands"
  };
  render();
}

function updateCommandQuery(query) {
  state.commandPalette.query = query;
  render();
  const input = document.querySelector("[data-command-search]");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function runCommand(commandId) {
  const command = commandItems().find((item) => item.id === commandId);
  if (!command) return;
  const keepPaletteOpen = command.id === "help:shortcuts";
  if (!keepPaletteOpen) {
    state.commandPalette.open = false;
    state.commandPalette.query = "";
    state.commandPalette.mode = "commands";
  }
  command.run();
}

function runFirstCommand() {
  const first = filteredCommandItems(state.commandPalette.query)[0];
  if (first) runCommand(first.id);
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
    button.addEventListener("click", (event) => {
      if (button.dataset.action === "close-command-palette" && event.target !== button) return;
      handleAction(button.dataset.action, button.dataset);
    });
  });
  document.querySelectorAll("[data-command-id]").forEach((button) => {
    button.addEventListener("click", () => runCommand(button.dataset.commandId));
  });
  document.querySelectorAll("[data-command-search]").forEach((input) => {
    input.addEventListener("input", () => updateCommandQuery(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runFirstCommand();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandPalette();
      }
    });
  });
  document.querySelectorAll("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.recordId) state.selectedId = button.dataset.recordId;
      render();
    });
  });
  document.querySelectorAll("[data-drag-work-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      state.selectedId = card.dataset.dragWorkId;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.dragWorkId);
      event.dataTransfer.setData("application/x-ctxlab-work-id", card.dataset.dragWorkId);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll("[data-board-column]").forEach((column) => column.classList.remove("drag-over"));
    });
  });
  document.querySelectorAll("[data-board-column]").forEach((column) => {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("drag-over");
      event.dataTransfer.dropEffect = "move";
    });
    column.addEventListener("dragleave", (event) => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const workItemId = event.dataTransfer.getData("application/x-ctxlab-work-id") || event.dataTransfer.getData("text/plain");
      if (workItemId) handleAction("move-work-status", { id: workItemId, status: column.dataset.boardColumn });
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
        setToast("Hafıza bağlantısı kaydedildi.");
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
  if (action === "toggle-theme") toggleTheme();
  if (action === "toggle-token-visibility") toggleTokenVisibility();
  if (action === "open-command-palette") openCommandPalette();
  if (action === "open-shortcuts") openCommandPalette("shortcuts");
  if (action === "close-command-palette") closeCommandPalette();
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
  if (action === "set-handoff-target") {
    state.handoffTarget = payload?.target || "codex";
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
  if (action === "link-suggested-work") {
    const target = payload?.suggestedWorkId || "";
    guarded(() => createWorkFromSelected(target));
  }
  if (action === "dismiss-triage-suggestion") {
    const target = payload?.suggestedWorkId || "";
    guarded(() => dismissTriageSuggestion(target));
  }
  if (action === "link-existing-work") {
    const target = document.querySelector("[data-link-work-target]")?.value || "";
    guarded(() => createWorkFromSelected(target));
  }
  if (action === "update-work-status") guarded(() => updateSelectedWorkStatus(payload));
  if (action === "move-work-status") guarded(() => moveWorkItemToStatus(payload?.id, payload?.status));
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

function isEditableTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
}

function focusSearchInput() {
  const search = document.querySelector("[data-search]");
  if (search) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier && key === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (state.commandPalette.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    }
    return;
  }

  if (isEditableTarget(event.target)) return;

  if (event.key === "?") {
    event.preventDefault();
    openCommandPalette("shortcuts");
    return;
  }
  if (event.key === "/") {
    event.preventDefault();
    focusSearchInput();
    return;
  }
  if (key === "escape") {
    closeCommandPalette();
    return;
  }
  if (key === "s") {
    event.preventDefault();
    handleAction("sync");
    return;
  }

  if (keyPrefix) {
    window.clearTimeout(keyPrefixTimer);
    const combo = `${keyPrefix} ${key}`;
    keyPrefix = "";
    const viewMap = {
      "g p": "workspace",
      "g i": "inbox",
      "g b": "board",
      "g d": "decisions",
      "g h": "handoff",
      "n s": "new-summary",
      "n w": "new-work",
      "n d": "new-decision"
    };
    if (viewMap[combo]) {
      event.preventDefault();
      setView(viewMap[combo]);
    }
    return;
  }

  if (key === "g" || key === "n") {
    keyPrefix = key;
    keyPrefixTimer = window.setTimeout(() => {
      keyPrefix = "";
    }, 900);
  }
}

document.addEventListener("keydown", handleGlobalKeydown);

refreshWarnings();
render();
refreshRunnerStatus({ silent: true });
