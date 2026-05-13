import "./styles.css";
import {
  buildDecisionFromSession,
  buildWorkItemFromSession,
  generateHandoffPrompt,
  getSection,
  groupByStatus,
  parseRepoInput,
  parseMemoryFile,
  replaceFrontmatter
} from "./domain.js";
import { deleteFile, loadMemoryRepo, moveFile, putFile } from "./github.js";
import { demoRecords } from "./fixtures.js";

const STORAGE_KEY = "ctxlab.config.v1";
const app = document.querySelector("#app");

const state = {
  view: "inbox",
  config: loadConfig(),
  records: [],
  selectedId: "",
  loading: false,
  toast: "",
  demo: false
};

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
      owner: "",
      repo: "",
      branch: "main",
      token: ""
    };
  } catch {
    return { owner: "", repo: "", branch: "main", token: "" };
  }
}

function saveConfig(config) {
  state.config = config;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function setToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 3600);
}

function setView(view) {
  state.view = view;
  render();
}

function recordsByType(type) {
  return state.records.filter((record) => record.type === type);
}

async function syncFromGitHub() {
  if (!state.config.owner || !state.config.repo) {
    setToast("Önce GitHub memory repo bağlantısını kaydet.");
    return;
  }
  state.loading = true;
  render();
  try {
    state.records = await loadMemoryRepo(state.config);
    state.demo = false;
    state.selectedId = state.records[0]?.id || "";
    setToast("Memory repo senkronize edildi.");
  } catch (error) {
    setToast(`Senkronizasyon başarısız: ${error.message}`);
  } finally {
    state.loading = false;
    render();
  }
}

function loadDemo() {
  state.records = demoRecords();
  state.selectedId = state.records[0]?.id || "";
  state.demo = true;
  setToast("Örnek veriler yüklendi.");
}

function selectedRecord() {
  return state.records.find((record) => record.id === state.selectedId) || state.records[0];
}

async function createWorkFromSelected() {
  const record = selectedRecord();
  if (!record) return;
  const work = buildWorkItemFromSession(record);

  if (!state.demo) {
    await putFile(
      state.config,
      work.path,
      work.content,
      `work: ${work.id} iş kartını oluştur`
    );
    const updatedInbox = replaceFrontmatter(record.raw, {
      status: "linked",
      linked_work_item: work.id
    });
    await putFile(
      state.config,
      record.path,
      updatedInbox,
      `inbox: ${record.id} iş kartına bağlandı`,
      record.sha
    );
  }

  const parsed = parseMemoryFile(work.path, work.content, `local-${Date.now()}`);
  state.records = [
    parsed,
    ...state.records.map((item) =>
      item.id === record.id
        ? { ...item, status: "linked", linkedWorkItem: work.id }
        : item
    )
  ];
  state.view = "board";
  state.selectedId = parsed.id;
  setToast("İş kartı oluşturuldu.");
}

async function archiveSelected() {
  const record = selectedRecord();
  if (!record || record.type !== "inbox") return;
  const fileName = record.path.split("/").pop();
  const archivePath = `archive/${fileName}`;

  if (!state.demo) {
    await moveFile(state.config, record, archivePath, `archive: ${record.id}`);
  }

  state.records = state.records.map((item) =>
    item.id === record.id ? { ...item, type: "archive", path: archivePath, status: "archived" } : item
  );
  setToast("Inbox kaydı arşivlendi.");
}

async function saveDecisionFromSelected() {
  const record = selectedRecord();
  if (!record) return;
  const decision = buildDecisionFromSession(record);
  if (!decision) {
    setToast("Bu oturumda karar bölümü bulunamadı.");
    return;
  }
  if (!state.demo) {
    await putFile(state.config, decision.path, decision.content, `decision: ${decision.id}`);
  }
  state.records = [parseMemoryFile(decision.path, decision.content, `local-${Date.now()}`), ...state.records];
  state.view = "decisions";
  setToast("Karar kaydı oluşturuldu.");
}

async function saveHandoff(target) {
  const record = selectedRecord();
  if (!record) return;
  const content = `---
id: handoff_${record.id}_${target}
source_record: ${record.id}
target: ${target}
created_at: ${new Date().toISOString()}
---

# Handoff

${generateHandoffPrompt(record, target)}
`;
  const path = `handoffs/handoff_${record.id}_${target}.md`;
  if (!state.demo) {
    await putFile(state.config, path, content, `handoff: ${record.id} -> ${target}`);
  }
  state.records = [parseMemoryFile(path, content, `local-${Date.now()}`), ...state.records];
  setToast("Handoff kaydı hazırlandı.");
}

function render() {
  const counts = {
    inbox: recordsByType("inbox").length,
    work: recordsByType("work_items").length,
    decisions: recordsByType("decisions").length,
    archive: recordsByType("archive").length
  };

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>ctx-lab</h1>
          <span>AI çalışma hafızası</span>
        </div>
        <nav class="nav" aria-label="Ana gezinme">
          ${navButton("inbox", `AI Inbox (${counts.inbox})`)}
          ${navButton("board", `İş Panosu (${counts.work})`)}
          ${navButton("decisions", `Karar Defteri (${counts.decisions})`)}
          ${navButton("handoff", "Handoff Üretici")}
          ${navButton("settings", "Repo Bağlantısı")}
        </nav>
        <div class="sync-panel">
          <span>${state.demo ? "Örnek veri modu" : repoLabel()}</span>
          <button class="primary" data-action="sync" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "Senkronize ediliyor" : "GitHub'dan Yenile"}
          </button>
          <button class="ghost" data-action="demo">Örnek verilerle dene</button>
        </div>
      </aside>
      <main class="content">
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

function renderCurrentView(counts) {
  if (state.view === "settings") return renderSettings();
  if (state.view === "board") return renderBoard();
  if (state.view === "decisions") return renderDecisions();
  if (state.view === "handoff") return renderHandoff();
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
  const inbox = recordsByType("inbox");
  const selected = selectedRecord();
  return `
    ${renderHeader(
      "AI Inbox",
      "Claude, Codex veya diğer araçlardan gelen oturum özetlerini işlenebilir bağlama dönüştür.",
      `<button data-action="sync">Yenile</button><button class="primary" data-action="demo">Örnek Veri</button>`
    )}
    <div class="stats">
      <div class="stat"><strong>${counts.inbox}</strong><span>Inbox kaydı</span></div>
      <div class="stat"><strong>${counts.work}</strong><span>İş kartı</span></div>
      <div class="stat"><strong>${counts.decisions}</strong><span>Karar</span></div>
      <div class="stat"><strong>${counts.archive}</strong><span>Arşiv</span></div>
    </div>
    <div class="grid two">
      <section class="record-list">
        ${inbox.length ? inbox.map(renderRecordCard).join("") : `<div class="empty">Inbox boş. Memory repo'ya session summary ekleyin veya örnek veri yükleyin.</div>`}
      </section>
      <section class="panel detail">
        ${selected ? renderRecordDetail(selected, true) : `<div class="empty">İncelemek için bir kayıt seçin.</div>`}
      </section>
    </div>
  `;
}

function renderBoard() {
  const workItems = recordsByType("work_items");
  const groups = groupByStatus(workItems);
  const columns = [
    ["active", "Aktif"],
    ["waiting", "Beklemede"],
    ["blocked", "Engelli"],
    ["done", "Tamamlandı"]
  ];
  return `
    ${renderHeader("İş Panosu", "Kalıcı gerçeklik burada tutulur; Inbox sadece triage alanıdır.")}
    <div class="board">
      ${columns.map(([status, title]) => `
        <section class="column">
          <h3>${title}</h3>
          ${(groups[status] || []).map(renderRecordCard).join("") || `<div class="empty">Kayıt yok.</div>`}
        </section>
      `).join("")}
    </div>
  `;
}

function renderDecisions() {
  const decisions = recordsByType("decisions");
  return `
    ${renderHeader("Karar Defteri", "Neyi neden seçtiğimizi oturum geçmişinden bağımsız saklar.")}
    <div class="grid">
      ${decisions.length ? decisions.map((record) => `<section class="panel">${renderRecordDetail(record, false)}</section>`).join("") : `<div class="empty">Henüz karar kaydı yok.</div>`}
    </div>
  `;
}

function renderHandoff() {
  const selected = selectedRecord();
  const prompt = selected ? generateHandoffPrompt(selected, "codex") : "";
  return `
    ${renderHeader("Handoff Üretici", "Seçili kayıttan Codex veya Claude için kısa devam prompt'u üret.")}
    <section class="panel detail">
      ${selected ? `
        <h3>${escapeHtml(selected.title)}</h3>
        <div class="toolbar-actions">
          <button class="primary" data-action="save-handoff-codex">Codex Handoff Kaydet</button>
          <button data-action="save-handoff-claude">Claude Handoff Kaydet</button>
          <button data-action="copy-handoff">Kopyala</button>
        </div>
        <pre class="handoff-output">${escapeHtml(prompt)}</pre>
      ` : `<div class="empty">Önce bir kayıt seçin.</div>`}
    </section>
  `;
}

function renderSettings() {
  return `
    ${renderHeader("Repo Bağlantısı", "Private GitHub memory repo bilgilerini gir.")}
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
          <button type="button" data-action="sync">Kaydetmeden Yenile</button>
        </div>
      </form>
    </section>
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
  return `
    <h3>${escapeHtml(record.title)}</h3>
    <div class="meta">
      <span class="badge ${record.status}">${statusLabel(record.status)}</span>
      <span>${escapeHtml(record.path)}</span>
      ${record.repo ? `<span>${escapeHtml(record.repo)}</span>` : ""}
    </div>
    ${withActions ? `
      <div class="toolbar-actions">
        <button class="primary" data-action="create-work">İş Kartına Dönüştür</button>
        <button data-action="save-decision">Karar Çıkar</button>
        <button data-action="archive">Arşivle</button>
      </div>
    ` : ""}
    ${detailSection("Amaç", getSection(record.sections, "goal") || getSection(record.sections, "objective"))}
    ${detailSection("Yapılanlar / Güncel Durum", getSection(record.sections, "happened") || getSection(record.sections, "current"))}
    ${detailSection("Kararlar", getSection(record.sections, "decisions"))}
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
    needs_triage: "Triage gerekli",
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
    button.addEventListener("click", () => handleAction(button.dataset.action));
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
}

function handleAction(action) {
  const guarded = async (fn) => {
    try {
      await fn();
      render();
    } catch (error) {
      setToast(error.message);
    }
  };

  if (action === "sync") guarded(syncFromGitHub);
  if (action === "demo") loadDemo();
  if (action === "create-work") guarded(createWorkFromSelected);
  if (action === "archive") guarded(archiveSelected);
  if (action === "save-decision") guarded(saveDecisionFromSelected);
  if (action === "save-handoff-codex") guarded(() => saveHandoff("codex"));
  if (action === "save-handoff-claude") guarded(() => saveHandoff("claude"));
  if (action === "copy-handoff") {
    const record = selectedRecord();
    if (record) navigator.clipboard.writeText(generateHandoffPrompt(record, "codex"));
    setToast("Handoff prompt'u kopyalandı.");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

render();
