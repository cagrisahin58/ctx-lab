const SECTION_ALIASES = {
  goal: ["Goal", "Amaç", "Hedef"],
  happened: ["What Happened", "Yapılanlar", "Ne Oldu"],
  decisions: ["Decisions", "Kararlar", "Karar"],
  questions: ["Open Questions", "Açık Sorular", "Sorular"],
  next: ["Next Action", "Next Actions", "Sonraki Adım", "Sonraki Adımlar", "Sıradaki İş", "Sıradaki İşler"],
  evidence: ["Evidence", "Kanıtlar", "Kaynaklar"],
  objective: ["Objective", "Amaç"],
  current: ["Current State", "Güncel Durum"],
  risks: ["Risks / Blockers", "Riskler / Engeller", "Engeller"],
  rationale: ["Rationale", "Gerekçe", "Neden"],
  impact: ["Impact", "Etki"],
  source_section: ["Source", "Kaynak", "Kanıt", "Kanıtlar"]
};

export const VALID_TYPES = ["inbox", "work_items", "decisions", "handoffs", "archive"];
export const VALID_STATUSES = ["needs_triage", "linked", "active", "waiting", "blocked", "done", "archived"];
export const WORK_STATUSES = ["active", "waiting", "blocked", "done"];
const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_ARCHIVE_SUGGESTION_DAYS = 14;
const STALE_WORK_ITEM_DAYS = 30;

export function parseRepoInput(input) {
  const trimmed = input.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  const [owner, repo] = trimmed.split("/");
  if (!owner || !repo) {
    throw new Error("Repo adresi owner/repo biçiminde olmalı.");
  }
  return { owner, repo };
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "is";
}

export function parseFrontmatter(content) {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content, errors: ["frontmatter bloğu yok"] };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: content, errors: ["frontmatter kapanış çizgisi eksik"] };
  }
  const raw = content.slice(3, end).trim();
  const body = content.slice(end + 4).trimStart();
  const errors = [];
  return { frontmatter: parseYamlLite(raw, errors), body, errors };
}

export function parseYamlLite(raw, errors = []) {
  const result = {};
  const lines = raw.split(/\r?\n/);
  let currentKey = null;

  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(parseScalar(listMatch[1]));
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      errors.push(`${index + 1}. satır okunamadı: ${line.trim()}`);
      continue;
    }
    currentKey = keyMatch[1];
    const value = keyMatch[2];
    if (value === "") {
      result[currentKey] = "";
    } else {
      result[currentKey] = parseScalar(value);
    }
  }

  return result;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseScalar(part.trim()));
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

export function serializeFrontmatter(frontmatter) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else if (value === null || value === undefined) {
      lines.push(`${key}:`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function replaceFrontmatter(content, patch) {
  const parsed = parseFrontmatter(content);
  return `${serializeFrontmatter({ ...parsed.frontmatter, ...patch })}\n\n${parsed.body}`;
}

export function parseSections(body) {
  const sections = {};
  let current = "intro";
  sections[current] = [];

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
    } else {
      sections[current].push(line);
    }
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [key, value.join("\n").trim()])
  );
}

export function getSection(sections, key) {
  const aliases = SECTION_ALIASES[key] || [key];
  const found = Object.entries(sections).find(([title]) =>
    aliases.some((alias) => title.toLowerCase() === alias.toLowerCase())
  );
  return found ? found[1] : "";
}

export function parseMemoryFile(path, content, sha = "") {
  const { frontmatter, body, errors = [] } = parseFrontmatter(content);
  const sections = parseSections(body);
  const h1 = body.match(/^#\s+(.+)$/m);
  const type = path.split("/")[0] || "unknown";
  const title = frontmatter.title || (h1 ? h1[1].trim() : frontmatter.id || path);

  return {
    path,
    sha,
    type,
    raw: content,
    frontmatter,
    frontmatterErrors: errors,
    sections,
    id: frontmatter.id || slugify(path),
    title,
    source: frontmatter.source || "",
    project: frontmatter.project || "",
    repo: frontmatter.repo || "",
    branch: frontmatter.branch || "",
    status: frontmatter.status || statusFromType(type),
    createdAt: frontmatter.created_at || frontmatter.updated_at || "",
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    linkedWorkItem: frontmatter.linked_work_item || "",
    summary: compactSummary(sections),
    nextAction: getSection(sections, "next") || getSection(sections, "current")
  };
}

export function validateMemoryRecords(records, now = new Date()) {
  const warnings = [];
  const seen = new Map();
  const nowTime = coerceTime(now);

  for (const record of records) {
    for (const error of record.frontmatterErrors || []) {
      warnings.push(`${record.path}: bozuk frontmatter (${error})`);
    }
    if (!VALID_TYPES.includes(record.type)) {
      warnings.push(`${record.path}: bilinmeyen klasör tipi (${record.type})`);
    }
    if (!hasFrontmatterKey(record, "id")) {
      warnings.push(`${record.path}: id alanı eksik`);
    }
    if (seen.has(record.id)) {
      warnings.push(`${record.path}: duplicate id (${record.id}), ilk kayıt: ${seen.get(record.id)}`);
    } else {
      seen.set(record.id, record.path);
    }
    if (!hasFrontmatterKey(record, "status")) {
      warnings.push(`${record.path}: status alanı eksik`);
    } else if (!VALID_STATUSES.includes(record.status)) {
      warnings.push(`${record.path}: bilinmeyen durum (${record.status})`);
    }
    if (record.type === "inbox" && !record.source) {
      warnings.push(`${record.path}: inbox kaydı için source alanı eksik`);
    }
    if (record.type === "work_items" && !record.frontmatter.title) {
      warnings.push(`${record.path}: iş hattı için title alanı eksik`);
    }
    if (record.type === "work_items") {
      warnings.push(...workItemLifecycleWarnings(record, nowTime));
      warnings.push(...workItemStatusHistoryWarnings(record));
    }
  }

  return warnings;
}

function hasFrontmatterKey(record, key) {
  return Object.prototype.hasOwnProperty.call(record.frontmatter || {}, key);
}

function workItemLifecycleWarnings(record, nowTime) {
  if (!Number.isFinite(nowTime)) return [];
  const touchedAt = coerceTime(record.frontmatter.updated_at || record.frontmatter.created_at || "");
  if (!Number.isFinite(touchedAt) || touchedAt > nowTime) return [];
  const ageDays = Math.floor((nowTime - touchedAt) / DAY_MS);

  if (record.status === "done" && ageDays >= DONE_ARCHIVE_SUGGESTION_DAYS) {
    return [`${record.path}: tamamlanan iş hattı ${ageDays} gündür arşiv bekliyor`];
  }
  if (WORK_STATUSES.includes(record.status) && record.status !== "done" && ageDays >= STALE_WORK_ITEM_DAYS) {
    return [`${record.path}: iş hattı ${ageDays} gündür güncellenmedi, sonraki adım gözden geçirilmeli`];
  }
  return [];
}

function workItemStatusHistoryWarnings(record) {
  const warnings = [];
  for (const item of normalizeArray(record.frontmatter?.status_history)) {
    const parsed = parseStatusHistoryEntry(item);
    if (!parsed) {
      warnings.push(`${record.path}: status_history kaydı okunamadı (${item})`);
      continue;
    }
    if (!WORK_STATUSES.includes(parsed.from) || !WORK_STATUSES.includes(parsed.to)) {
      warnings.push(`${record.path}: status_history içinde bilinmeyen durum (${parsed.from}->${parsed.to})`);
    }
  }
  return warnings;
}

function coerceTime(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value || "").getTime();
  return Number.isNaN(time) ? NaN : time;
}

export function buildOnboardingChecklist(input = {}) {
  const config = input.config || {};
  const diagnostics = input.diagnostics || null;
  const runner = input.runner || {};
  const cacheMeta = input.cacheMeta || {};
  const records = Array.isArray(input.records) ? input.records : [];
  const hasMemoryConfig = Boolean(config.owner && config.repo && (config.branch || "main"));
  const hasToken = Boolean(String(config.token || "").trim());
  const repoReady = Boolean(diagnostics?.ok || cacheMeta.syncedAt || records.length);
  const mirrorReady = Boolean(runner.memory?.indexed);
  const projectReady = Boolean(runner.projects?.length);
  const codexReady = Boolean(runner.health?.codex?.available);
  const briefReady = Boolean(input.briefReady);

  return [
    {
      id: "memory_connection",
      label: "GitHub hafıza reposu",
      description: "Owner/repo, branch ve token kaydedilir.",
      done: hasMemoryConfig && hasToken,
      action: "settings"
    },
    {
      id: "repo_diagnostics",
      label: "Repo yapısı ve yazma testi",
      description: "config.yaml, klasörler ve Contents read/write yetkisi doğrulanır.",
      done: repoReady,
      action: "diagnose"
    },
    {
      id: "local_mirror",
      label: "Yerel ayna ve indeks",
      description: "work-memory yerel Git aynası olarak çekilir ve JSON indeks üretilir.",
      done: mirrorReady,
      action: "mirror"
    },
    {
      id: "project_root",
      label: "Yerel proje kökü",
      description: "Codex otomasyonu için izinli proje klasörü kaydedilir.",
      done: projectReady,
      action: "project"
    },
    {
      id: "codex_cli",
      label: "Codex CLI kontrolü",
      description: "codex.cmd bulunur ve sürüm bilgisi okunur.",
      done: codexReady,
      action: "runner"
    },
    {
      id: "sample_brief",
      label: "Örnek devam brifi",
      description: "Temiz bir AI oturumuna verilecek ilk devam brifi önizlenir.",
      done: briefReady,
      action: "brief"
    }
  ];
}

export function isOnboardingComplete(checklist = []) {
  return Array.isArray(checklist) && checklist.length > 0 && checklist.every((item) => item.done);
}

export function buildTimelineEvents(records, runnerProjects = [], runs = [], sync = {}) {
  const events = [];

  for (const record of records) {
    const base = {
      id: `record:${record.path}`,
      recordId: record.id,
      project: record.project || "genel",
      repo: record.repo || "",
      status: record.status || "",
      title: record.title,
      summary: record.summary || "",
      nextAction: record.nextAction || getSection(record.sections || {}, "next") || "",
      path: record.path,
      at: record.frontmatter?.updated_at || record.frontmatter?.created_at || record.frontmatter?.archived_at || ""
    };

    if (record.type === "inbox") {
      events.push({
        ...base,
        kind: "session",
        label: "Oturum",
        title: record.title || "Oturum özeti",
        at: record.frontmatter?.created_at || base.at
      });
    } else if (record.type === "work_items") {
      events.push({
        ...base,
        kind: "work_item",
        label: "İş hattı",
        summary: getSection(record.sections || {}, "current") || base.summary,
        at: record.frontmatter?.updated_at || base.at
      });
      for (const change of parseStatusHistory(record.frontmatter?.status_history)) {
        events.push({
          ...base,
          id: `status:${record.id}:${change.at}:${change.from}-${change.to}`,
          kind: "status_change",
          label: "Durum değişimi",
          status: change.to,
          title: `${timelineStatusLabel(change.from)} → ${timelineStatusLabel(change.to)}`,
          summary: `${record.title || record.id} iş hattı ${timelineStatusLabel(change.to).toLocaleLowerCase("tr")} durumuna taşındı.`,
          at: change.at
        });
      }
    } else if (record.type === "decisions") {
      events.push({
        ...base,
        kind: "decision",
        label: "Karar",
        summary: getSection(record.sections || {}, "decisions") || base.summary,
        at: record.frontmatter?.created_at || base.at
      });
    } else if (record.type === "handoffs") {
      events.push({
        ...base,
        kind: record.frontmatter?.kind === "codex_run" ? "codex_run" : "handoff",
        label: record.frontmatter?.kind === "codex_run" ? "Codex çalıştırma" : "Devam brifi",
        at: record.frontmatter?.created_at || base.at
      });
    } else if (record.type === "archive") {
      events.push({
        ...base,
        kind: "archive",
        label: "Arşiv",
        at: record.frontmatter?.archived_at || base.at
      });
    }
  }

  for (const run of runs || []) {
    const project = run.project?.name || "genel";
    const repo = run.project?.repo || "";
    const path = run.logPath || "";
    events.push({
      id: `run:${run.id}`,
      recordId: run.id,
      kind: "codex_run",
      label: "Codex çalıştırma",
      project,
      repo,
      status: run.status || "",
      title: `${run.automationLevel || "brief"} · ${run.template || "continue_work"}`,
      summary: run.summary || run.error || run.stderr || "Codex çalıştırma kaydı.",
      nextAction: "",
      path,
      at: run.finishedAt || run.updatedAt || run.createdAt || ""
    });

    if (run.commitApplication?.status) {
      events.push({
        id: `run-commit:${run.id}`,
        recordId: run.id,
        kind: "commit_application",
        label: "Commit uygulaması",
        project,
        repo,
        status: run.commitApplication.status,
        title: commitApplicationStatusLabel(run.commitApplication.status),
        summary: commitApplicationEventSummary(run.commitApplication),
        nextAction: run.commitApplication.status === "push_failed" ? "Push hatasını incele." : "",
        path,
        at: run.commitApplication.appliedAt || run.updatedAt || run.finishedAt || run.createdAt || ""
      });
    }
  }

  for (const project of runnerProjects || []) {
    events.push({
      id: `project:${project.id}`,
      recordId: project.id,
      kind: "project_registered",
      label: "Proje kökü",
      project: project.name || "proje",
      repo: project.repo || "",
      status: "registered",
      title: project.path || project.name,
      summary: "Yerel proje kökü otomasyon allowlist'ine eklendi.",
      nextAction: "",
      path: project.path || "",
      at: project.updatedAt || project.createdAt || ""
    });
  }

  if (sync.cacheMeta?.syncedAt) {
    events.push({
      id: "sync:github-cache",
      recordId: "",
      kind: "github_sync",
      label: "GitHub senkron",
      project: sync.project || "genel",
      repo: sync.repo || "",
      status: "synced",
      title: "GitHub hafıza senkronizasyonu",
      summary: `${sync.recordCount ?? records.length} kayıt yerel önbelleğe alındı.`,
      nextAction: "",
      path: "",
      at: sync.cacheMeta.syncedAt
    });
  }

  if (sync.memory?.lastIndexedAt) {
    events.push({
      id: "sync:memory-mirror",
      recordId: "",
      kind: "mirror_sync",
      label: "Yerel ayna",
      project: sync.project || "genel",
      repo: sync.repo || "",
      status: sync.memory.indexed ? "indexed" : "waiting",
      title: "Yerel hafıza aynası indekslendi",
      summary: `${sync.memory.recordCount || 0} kayıt yerel aynadan okundu.`,
      nextAction: "",
      path: sync.memory.cloneDir || "",
      at: sync.memory.lastIndexedAt
    });
  }

  return events.sort((a, b) => eventTime(b.at) - eventTime(a.at) || a.label.localeCompare(b.label, "tr"));
}

function statusFromType(type) {
  if (type === "inbox") return "needs_triage";
  if (type === "archive") return "archived";
  return "active";
}

function parseStatusHistory(value) {
  return normalizeArray(value)
    .map(parseStatusHistoryEntry)
    .filter(Boolean);
}

function parseStatusHistoryEntry(value) {
  const match = String(value || "").trim().match(/^([^|]+)\|([A-Za-z0-9_-]+)->([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return {
    at: match[1],
    from: match[2],
    to: match[3]
  };
}

function timelineStatusLabel(status) {
  return {
    active: "Aktif",
    waiting: "Beklemede",
    blocked: "Engelli",
    done: "Tamamlandı"
  }[status] || status || "Durum yok";
}

function compactSummary(sections) {
  return (
    getSection(sections, "goal") ||
    getSection(sections, "happened") ||
    sections.intro ||
    ""
  ).replace(/\n+/g, " ").slice(0, 280);
}

export function groupByStatus(records) {
  return records.reduce((acc, record) => {
    const key = record.status || "unknown";
    acc[key] = acc[key] || [];
    acc[key].push(record);
    return acc;
  }, {});
}

export function filterRecords(records, query) {
  const tokens = String(query || "")
    .toLocaleLowerCase("tr")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return records;

  return records.filter((record) => {
    const haystack = [
      record.title,
      record.summary,
      record.project,
      record.repo,
      record.branch,
      record.status,
      record.source,
      record.path,
      record.nextAction,
      ...normalizeArray(record.tags)
    ].join(" ").toLocaleLowerCase("tr");
    return tokens.every((token) => haystack.includes(token));
  });
}

export function upsertRecord(records, record) {
  return [
    record,
    ...records.filter((item) => item.id !== record.id && item.path !== record.path)
  ];
}

export function buildWorkItemFromSession(session) {
  const workId = `work_${slugify(session.project || session.title)}`;
  const now = new Date().toISOString();
  const title = session.project
    ? `${session.project} çalışma hattı`
    : session.title.replace(/^(Session Summary|Oturum Özeti)$/i, "Yeni çalışma hattı");

  const content = `${serializeFrontmatter({
    id: workId,
    title,
    project: session.project || "",
    repo: session.repo || "",
    branch: session.branch || "main",
    status: "active",
    priority: "normal",
    updated_at: now,
    tags: normalizeArray(session.tags),
    sessions: [session.id],
    decisions: []
  })}

## Objective
${getSection(session.sections, "goal") || session.summary || "Bu işin amacı netleştirilecek."}

## Current State
${getSection(session.sections, "happened") || "İlk oturum özeti iş hattına bağlandı."}

## Next Action
${getSection(session.sections, "next") || "Bir sonraki somut adım belirlenecek."}

## Risks / Blockers
${getSection(session.sections, "questions") || "Bilinen engel yok."}

## Devam Brifi
${generateHandoffPrompt(session, "codex")}
`;

  return {
    id: workId,
    path: `work_items/${workId}.md`,
    content
  };
}

export function buildManualWorkItem(draft, now = new Date()) {
  const title = String(draft.title || draft.project || "Yeni çalışma hattı").trim();
  const project = String(draft.project || title).trim();
  const workId = draft.id || `work_${slugify(title)}`;
  const content = `${serializeFrontmatter({
    id: workId,
    title,
    project,
    repo: draft.repo || "",
    branch: draft.branch || "main",
    status: "active",
    priority: draft.priority || "normal",
    updated_at: now.toISOString(),
    sessions: [],
    decisions: []
  })}

## Objective
${formatSectionText(draft.objective || "Bu işin amacı netleştirilecek.")}

## Current State
${formatSectionText(draft.current || "İş hattı manuel olarak açıldı.")}

## Next Action
${formatSectionText(draft.next || "Bir sonraki somut adım belirlenecek.")}

## Risks / Blockers
${formatSectionText(draft.risks || "Bilinen engel yok.")}

## Devam Brifi
Bu çalışma hattını devral. Proje: ${project || "belirsiz"}. Repo: ${draft.repo || "belirsiz"}. Önce mevcut repo durumunu oku, sonra yalnızca bu hedefle ilgili değişiklikleri öner veya uygula.
`;

  return {
    id: workId,
    path: `work_items/${workId}.md`,
    content
  };
}

export function appendSessionToWorkItem(workItem, session) {
  const existingSessions = normalizeArray(workItem.frontmatter.sessions);
  const sessions = existingSessions.includes(session.id)
    ? existingSessions
    : [...existingSessions, session.id];

  return replaceFrontmatter(workItem.raw, {
    sessions,
    updated_at: new Date().toISOString()
  });
}

export function findWorkItemForSession(records, session) {
  if (!session) return null;
  return records.find((record) => {
    if (record.type !== "work_items") return false;
    return record.id === session.linkedWorkItem ||
      normalizeArray(record.frontmatter.sessions).includes(session.id);
  }) || null;
}

export function suggestWorkItemForSession(records, session, options = {}) {
  if (!session || session.type !== "inbox") return null;
  if (session.status !== "needs_triage" || session.linkedWorkItem) return null;
  const threshold = options.threshold || 5;
  const now = options.now || new Date();
  const dismissed = new Set(normalizeArray(session.frontmatter.triage_suggestion_dismissed));
  const candidates = records
    .filter((record) => record.type === "work_items")
    .filter((record) => !["done", "archived"].includes(record.status))
    .filter((record) => !dismissed.has(record.id))
    .map((workItem) => scoreWorkItemForSession(workItem, session, now))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score || String(b.workItem.createdAt).localeCompare(String(a.workItem.createdAt)));

  return candidates[0] || null;
}

export function dismissTriageSuggestionContent(session, workItemId, now = new Date()) {
  const dismissed = normalizeArray(session.frontmatter.triage_suggestion_dismissed);
  const triageSuggestionDismissed = dismissed.includes(workItemId)
    ? dismissed
    : [...dismissed, workItemId];

  return replaceFrontmatter(session.raw, {
    triage_suggestion_dismissed: triageSuggestionDismissed,
    updated_at: now.toISOString()
  });
}

function scoreWorkItemForSession(workItem, session, now) {
  const reasons = [];
  let score = 0;

  if (sameText(workItem.project, session.project)) {
    score += 5;
    reasons.push("proje eşleşmesi");
  }
  if (sameText(workItem.repo, session.repo)) {
    score += 3;
    reasons.push("repo eşleşmesi");
  }

  const workTags = new Set(normalizeArray(workItem.tags).map(normalizeText).filter(Boolean));
  const commonTags = normalizeArray(session.tags)
    .map(normalizeText)
    .filter((tag) => tag && workTags.has(tag));
  if (commonTags.length) {
    score += commonTags.length;
    reasons.push(`${commonTags.length} ortak etiket`);
  }

  const touchedAt = new Date(workItem.frontmatter.updated_at || workItem.createdAt || "");
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (!Number.isNaN(touchedAt.getTime()) && now.getTime() - touchedAt.getTime() <= sevenDaysMs) {
    score += 2;
    reasons.push("son 7 günde güncellendi");
  }

  return { workItem, score, reasons };
}

export function appendDecisionToWorkItem(workItem, decision, now = new Date()) {
  const existingDecisions = normalizeArray(workItem.frontmatter.decisions);
  const decisions = existingDecisions.includes(decision.id)
    ? existingDecisions
    : [...existingDecisions, decision.id];

  return replaceFrontmatter(workItem.raw, {
    decisions,
    updated_at: now.toISOString()
  });
}

export function appendCodexRunToWorkItem(workItem, runRecord, now = new Date()) {
  const runId = typeof runRecord === "string" ? runRecord : runRecord?.id;
  if (!runId) throw new Error("Codex çalıştırma id yok.");
  const existingRuns = normalizeArray(workItem.frontmatter.codex_runs);
  const codex_runs = existingRuns.includes(runId)
    ? existingRuns
    : [...existingRuns, runId];

  return replaceFrontmatter(workItem.raw, {
    codex_runs,
    updated_at: now.toISOString()
  });
}

export function updateWorkItemStatusContent(workItem, status, now = new Date()) {
  if (!WORK_STATUSES.includes(status)) {
    throw new Error(`Geçersiz iş hattı durumu: ${status}`);
  }
  const updatedAt = now.toISOString();
  const previousStatus = workItem.status || workItem.frontmatter?.status || "";
  const statusPatch = previousStatus && previousStatus !== status
    ? {
        status_history: [
          ...normalizeArray(workItem.frontmatter?.status_history),
          `${updatedAt}|${previousStatus}->${status}`
        ]
      }
    : {};
  return replaceFrontmatter(workItem.raw, {
    status,
    updated_at: updatedAt,
    ...statusPatch
  });
}

export function updateWorkItemNextActionContent(workItem, nextAction, now = new Date()) {
  const text = String(nextAction || "").trim();
  if (!text) {
    throw new Error("Sonraki adım boş olamaz.");
  }
  const { frontmatter, body } = parseFrontmatter(workItem.raw);
  const updatedBody = replaceSection(body, "next", "Next Action", text);
  return `${serializeFrontmatter({ ...frontmatter, updated_at: now.toISOString() })}\n\n${updatedBody}`;
}

export function buildArchivedRecordContent(record, now = new Date()) {
  return replaceFrontmatter(record.raw, {
    status: "archived",
    archived_at: now.toISOString()
  });
}

export function resolveWorkContext(records, anchorRecord) {
  if (!anchorRecord) {
    return { workItem: null, sessions: [], decisions: [] };
  }

  const workItem = anchorRecord.type === "work_items"
    ? anchorRecord
    : records.find((record) => record.id === anchorRecord.linkedWorkItem) || null;
  const sessionIds = new Set(normalizeArray(workItem?.frontmatter.sessions));
  if (anchorRecord.type === "inbox") sessionIds.add(anchorRecord.id);

  const sessions = sortRecords(
    records.filter((record) =>
      record.type === "inbox" && (
        sessionIds.has(record.id) ||
        (workItem && record.linkedWorkItem === workItem.id)
      )
    )
  );
  const resolvedSessionIds = new Set(sessions.map((record) => record.id));
  const decisionIds = new Set(normalizeArray(workItem?.frontmatter.decisions));
  const project = workItem?.project || anchorRecord.project;

  const decisions = sortRecords(
    records.filter((record) =>
      record.type === "decisions" && (
        decisionIds.has(record.id) ||
        (workItem && record.frontmatter.source_work_item === workItem.id) ||
        resolvedSessionIds.has(record.frontmatter.source_session) ||
        (project && record.project === project)
      )
    )
  );

  return { workItem, sessions, decisions };
}

export function buildContextPack(records, anchorRecord, target = "codex") {
  const toolName = target === "claude" ? "Claude Code" : "Codex";
  const { workItem, sessions, decisions } = resolveWorkContext(records, anchorRecord);
  const base = workItem || anchorRecord;
  if (!base) return `${toolName} için devam brifi üretilecek kayıt bulunamadı.`;

  const latestSession = sessions[0] || (base.type === "inbox" ? base : null);
  const objective = getSection(base.sections, "objective") || getSection(base.sections, "goal") || base.summary || base.title;
  const current = getSection(base.sections, "current") || getSection(latestSession?.sections || {}, "happened") || base.summary || "Güncel durum kayıtlardan net çıkarılamadı.";
  const next = getSection(base.sections, "next") || getSection(latestSession?.sections || {}, "next") || "Sıradaki somut adım kayıtlardan net çıkarılamadı.";
  const risks = getSection(base.sections, "risks") || getSection(latestSession?.sections || {}, "questions") || "Kayıtlı risk veya açık soru yok.";

  return [
    `${toolName} için ctx-lab devam brifi`,
    "",
    `İş hattı: ${base.title}`,
    `Proje: ${base.project || "belirsiz"}`,
    `Repo: ${base.repo || latestSession?.repo || "belirsiz"}`,
    `Dal: ${base.branch || latestSession?.branch || "belirsiz"}`,
    "",
    "Amaç:",
    objective,
    "",
    "Güncel durum:",
    current,
    "",
    "Sıradaki adım:",
    next,
    "",
    "Riskler / açık sorular:",
    risks,
    "",
    "Bağlı oturumlar:",
    formatSessionBullets(sessions),
    "",
    "Karar kayıtları:",
    formatDecisionBullets(decisions),
    "",
    "Çalışma kuralı:",
    "Önce mevcut repo durumunu oku. Yalnızca bu iş hattıyla ilgili değişiklikleri öner veya uygula. Kayıtlarda olmayan dosya, commit, metrik veya karar uydurma; eksik bağlamı açıkça belirt."
  ].join("\n");
}

export function buildDailyBrief(records, target = "codex", now = new Date()) {
  const toolName = target === "claude" ? "Claude Code" : "Codex";
  const workItems = sortWorkItems(
    records.filter((record) => record.type === "work_items" && record.status !== "done")
  );
  const triageCount = records.filter((record) => record.type === "inbox" && record.status === "needs_triage").length;
  const blockedCount = workItems.filter((record) => record.status === "blocked").length;
  const waitingCount = workItems.filter((record) => record.status === "waiting").length;

  return [
    `${toolName} için ctx-lab günlük çalışma brifi`,
    "",
    `Tarih: ${now.toISOString()}`,
    `Açık iş: ${workItems.length} | Engelli: ${blockedCount} | Beklemede: ${waitingCount} | İşleme bekleyen oturum: ${triageCount}`,
    "",
    "Öncelikli işler:",
    workItems.length ? workItems.slice(0, 10).map((workItem, index) => formatWorkBrief(records, workItem, index)).join("\n") : "- Açık iş kaydı yok.",
    "",
    "İşleme bekleyen oturumlar:",
    triageCount ? `- ${triageCount} oturum kaydı işlenmeyi bekliyor.` : "- İşleme bekleyen oturum kaydı yok.",
    "",
    "Çalışma kuralı:",
    "Önce repo durumunu ve seçili iş hattının devam brifini oku. Kayıtlarda olmayan karar, dosya, commit veya metrik uydurma."
  ].join("\n");
}

export function buildCodexRunMemoryRecord(run, sourceRecord = null, now = new Date()) {
  if (!run?.id) throw new Error("Codex çalıştırma kaydı için run id zorunlu.");
  const stamp = timestampSlug(now);
  const memoryId = `codex_run_${slugify(run.id)}`;
  const project = run.project?.name || sourceRecord?.project || "genel";
  const repo = run.project?.repo || sourceRecord?.repo || "";
  const branch = run.project?.branch || sourceRecord?.branch || "main";
  const sourceWorkItem = run.sourceWorkItemId || (sourceRecord?.type === "work_items" ? sourceRecord.id : sourceRecord?.linkedWorkItem || "");
  const sourceRecordId = run.sourceRecordId || sourceRecord?.id || "";
  const status = run.status || "unknown";
  const summary = run.summary || run.error || run.stderr || "Codex çalıştırma sonucu yerel günlük kaydına yazıldı.";
  const resultText = run.stdout || run.stderr || run.error || run.summary || "Çalıştırma çıktısı yerel günlük dosyasında.";
  const changedFiles = Array.isArray(run.gitAfter?.changedFiles) ? run.gitAfter.changedFiles : [];
  const changeSummary = changedFiles.length
    ? changedFiles.map((file) => `- ${file}`).join("\n")
    : "Git değişikliği tespit edilmedi veya snapshot yok.";
  const commitReadiness = formatCommitReadiness(run.commitReadiness);
  const commitDraft = formatCommitDraft(run.commitDraft);
  const commitApplication = formatCommitApplication(run.commitApplication);
  const content = `${serializeFrontmatter({
    id: memoryId,
    kind: "codex_run",
    source_run: run.id,
    source_record: sourceRecordId,
    source_work_item: sourceWorkItem,
    project,
    repo,
    branch,
    target: "codex",
    status,
    automation_level: run.automationLevel || "brief",
    template: run.template || "continue_work",
    created_at: run.createdAt || now.toISOString(),
    updated_at: run.updatedAt || now.toISOString(),
    log_path: run.logPath || "",
    event_log_path: run.eventLogPath || ""
  })}

# Codex Çalıştırma Kaydı

## Güncel Durum
${formatSectionText(summary)}

## Sonuç
${formatSectionText(resultText)}

## Değişiklik Özeti
${changeSummary}

${commitReadiness ? `## Commit Hazırlığı
${commitReadiness}

` : ""}${commitDraft ? `## Commit Taslağı
${commitDraft}

` : ""}${commitApplication ? `## Commit Uygulaması
${commitApplication}

` : ""}## Kaynak
- Çalıştırma id: ${run.id}
- Kaynak kayıt: ${sourceRecordId || "yok"}
- İş hattı: ${sourceWorkItem || "yok"}
- Otomasyon seviyesi: ${run.automationLevel || "brief"}
- Şablon: ${run.template || "continue_work"}
- Günlük: ${run.logPath || "yerel günlük yolu yok"}
- Olay günlüğü: ${run.eventLogPath || "yerel olay günlüğü yok"}
`;

  return {
    id: memoryId,
    path: `handoffs/${stamp}-${memoryId}.md`,
    content
  };
}

function sortWorkItems(records) {
  const order = { blocked: 0, active: 1, waiting: 2, done: 3 };
  return [...records].sort((a, b) => {
    const statusDelta = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (statusDelta) return statusDelta;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

function formatWorkBrief(records, workItem, index) {
  const { sessions, decisions } = resolveWorkContext(records, workItem);
  const next = getSection(workItem.sections, "next") || workItem.nextAction || "Sonraki adım kayıtlarda yok.";
  const current = getSection(workItem.sections, "current") || workItem.summary || "Güncel durum kayıtlarda yok.";
  return [
    `${index + 1}. ${workItem.title} [${workItem.status}]`,
    `   Proje: ${workItem.project || "belirsiz"} | Oturum: ${sessions.length} | Karar: ${decisions.length}`,
    `   Güncel durum: ${compactLine(current)}`,
    `   Sonraki adım: ${compactLine(next)}`
  ].join("\n");
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value];
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function sameText(left, right) {
  return normalizeText(left) === normalizeText(right) && normalizeText(left) !== "";
}

function sortRecords(records) {
  return [...records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function formatSessionBullets(sessions) {
  if (!sessions.length) return "- Bağlı oturum kaydı yok.";
  return sessions.slice(0, 6).map((session) => {
    const happened = getSection(session.sections, "happened") || session.summary || "Özet yok.";
    const next = getSection(session.sections, "next") || "Sonraki adım belirtilmedi.";
    return `- ${session.id} (${session.source || "kaynak yok"}, ${session.createdAt || "tarih yok"}): ${compactLine(happened)} Sonraki: ${compactLine(next)}`;
  }).join("\n");
}

function formatDecisionBullets(decisions) {
  if (!decisions.length) return "- Kayıtlı karar yok.";
  return decisions.slice(0, 6).map((decision) => {
    const value = getSection(decision.sections, "decisions") || getSection(decision.sections, "Karar") || decision.summary || decision.title;
    return `- ${decision.id}: ${compactLine(value)}`;
  }).join("\n");
}

function compactLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 260);
}

function eventTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function replaceSection(body, key, fallbackTitle, value) {
  const lines = body.split(/\r?\n/);
  const aliases = SECTION_ALIASES[key] || [fallbackTitle];
  const start = lines.findIndex((line) => {
    const match = line.match(/^##\s+(.+)$/);
    return match && aliases.some((alias) => match[1].trim().toLowerCase() === alias.toLowerCase());
  });

  if (start === -1) {
    return `${body.trimEnd()}\n\n## ${fallbackTitle}\n${value}\n`;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return [
    ...lines.slice(0, start + 1),
    value,
    "",
    ...lines.slice(end)
  ].join("\n").trimEnd() + "\n";
}

export function buildInboxSessionSummary(draft, now = new Date()) {
  const source = draft.source || "codex";
  const project = draft.project || "genel";
  const stamp = timestampSlug(now);
  const id = draft.id || `sess_${stamp}_${slugify(project)}_${slugify(source)}`;
  const path = `inbox/${stamp}-${slugify(project)}-${slugify(source)}.md`;
  const content = `${serializeFrontmatter({
    id,
    source,
    project,
    repo: draft.repo || "",
    branch: draft.branch || "main",
    status: "needs_triage",
    created_at: now.toISOString(),
    tags: normalizeArray(draft.tags),
    linked_work_item: ""
  })}

# Oturum Özeti

## Amaç
${draft.goal || "Bu oturumun amacı yazılacak."}

## Yapılanlar
${formatSectionText(draft.happened || "Yapılanlar yazılacak.")}

## Kararlar
${formatSectionText(draft.decisions || "Kayıtlı karar yok.")}

## Açık Sorular
${formatSectionText(draft.questions || "Açık soru yok.")}

## Sonraki Adımlar
${formatSectionText(draft.next || "Sıradaki adım netleştirilecek.")}

## Kanıtlar
${formatSectionText(draft.evidence || "Kaynak belirtilmedi.")}
`;
  return { id, path, content };
}

export function buildInboxSessionSummaryFromMarkdown(raw, fallback = {}, now = new Date()) {
  const parsed = parseFrontmatter(String(raw || "").trim());
  const frontmatter = parsed.frontmatter;
  const source = frontmatter.source || fallback.source || "manual";
  const project = frontmatter.project || fallback.project || "genel";
  const createdAt = frontmatter.created_at || now.toISOString();
  const createdDate = new Date(createdAt);
  const stamp = timestampSlug(Number.isNaN(createdDate.getTime()) ? now : createdDate);
  const id = frontmatter.id || `sess_${stamp}_${slugify(project)}_${slugify(source)}`;
  const body = normalizeSessionBodyTitle(parsed.body.trim() || defaultSessionBody());
  const content = `${serializeFrontmatter({
    id,
    source,
    project,
    repo: frontmatter.repo || fallback.repo || "",
    branch: frontmatter.branch || fallback.branch || "main",
    status: "needs_triage",
    created_at: createdAt,
    tags: normalizeArray(frontmatter.tags || fallback.tags),
    linked_work_item: frontmatter.linked_work_item || ""
  })}

${body}
`;

  return {
    id,
    path: `inbox/${stamp}-${slugify(project)}-${slugify(source)}.md`,
    content
  };
}

export function buildSessionClosePrompt(defaults = {}) {
  const source = defaults.source || "codex";
  const project = defaults.project || "<proje>";
  const repo = defaults.repo || "<owner/repo>";
  const branch = defaults.branch || "main";

  return `Bu oturumu ctx-lab AI çalışma hafızası için özetle.

Yalnızca aşağıdaki markdown şemasını doldur. Kısa, kanıtlı ve eyleme dönük yaz. Uydurma dosya, commit, sayı veya karar ekleme; emin olmadığın yerleri "Belirsiz" diye işaretle.

---
source: ${source}
project: ${project}
repo: ${repo}
branch: ${branch}
status: needs_triage
tags:
  - ai-session
linked_work_item:
---

# Oturum Özeti

## Amaç

## Yapılanlar

## Kararlar

## Açık Sorular

## Sonraki Adımlar

## Kanıtlar
`;
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function defaultSessionBody() {
  return `# Oturum Özeti

## Amaç
Bu oturumun amacı yazılacak.

## Yapılanlar
Yapılanlar yazılacak.

## Kararlar
Kayıtlı karar yok.

## Açık Sorular
Açık soru yok.

## Sonraki Adımlar
Sıradaki adım netleştirilecek.

## Kanıtlar
Kaynak belirtilmedi.`;
}

function normalizeSessionBodyTitle(body) {
  return String(body || "").replace(/^#\s+Session Summary\s*$/im, "# Oturum Özeti");
}

function formatSectionText(value) {
  const text = String(value).trim();
  if (!text) return "";
  if (text.includes("\n") || text.startsWith("- ")) return text;
  return text;
}

function formatCommitReadiness(readiness) {
  if (!readiness) return "";
  const lines = [
    `Durum: ${readiness.ready ? "Gözden geçirmeye hazır" : "Hazır değil"}`,
    readiness.summary ? `Özet: ${readiness.summary}` : ""
  ].filter(Boolean);
  for (const check of readiness.checks || []) {
    lines.push(`- ${check.ok ? "OK" : "Eksik"}: ${check.label || check.id || "Kontrol"} - ${check.detail || ""}`.trim());
  }
  return lines.join("\n");
}

function formatCommitDraft(draft) {
  if (!draft) return "";
  const lines = [
    `Durum: ${draft.ready ? "Hazır" : "Hazır değil"}`,
    `Commit mesajı: ${draft.message || "hazır değil"}`,
    `Push durumu: ${draft.pushAllowed ? "Push için hazır" : "Kapalı"}`,
    draft.note ? `Not: ${draft.note}` : ""
  ].filter(Boolean);
  const body = Array.isArray(draft.body) ? draft.body : [];
  if (body.length) {
    lines.push("", "Gövde:");
    for (const line of body) lines.push(`- ${line}`);
  }
  const changedFiles = Array.isArray(draft.changedFiles) ? draft.changedFiles : [];
  if (changedFiles.length) {
    lines.push("", "Değişen dosyalar:");
    for (const file of changedFiles) lines.push(`- ${file}`);
  }
  return lines.join("\n");
}

function formatCommitApplication(application) {
  if (!application) return "";
  return [
    `Durum: ${commitApplicationStatusLabel(application.status)}`,
    `Commit SHA: ${application.commitSha || "yok"}`,
    application.appliedAt ? `Uygulama zamanı: ${application.appliedAt}` : ""
  ].filter(Boolean).join("\n");
}

function commitApplicationStatusLabel(status) {
  if (status === "pushed") return "Push tamamlandı";
  if (status === "push_failed") return "Push hata verdi";
  if (status === "committed") return "Commit tamamlandı";
  return "Commit uygulaması kaydedildi";
}

function commitApplicationEventSummary(application) {
  const detail = application.status === "push_failed"
    ? (application.pushStderr || application.pushStdout || "Ayrıntı yerel günlükte.")
    : (application.status === "pushed" ? "Değişiklikler uzak repoya gönderildi." : "Değişiklikler yerel commit olarak uygulandı.");
  const commit = application.commitSha ? `Commit SHA: ${application.commitSha}` : "Commit SHA yok";
  return `${commit} · ${detail}`.slice(0, 320);
}

export function generateHandoffPrompt(record, target = "codex") {
  const toolName = target === "claude" ? "Claude Code" : "Codex";
  const goal = getSection(record.sections, "goal") || record.summary || record.title;
  const happened = getSection(record.sections, "happened") || "Önceki oturum özeti incelenecek.";
  const decisions = getSection(record.sections, "decisions") || "Kayıtlı karar yok.";
  const next = getSection(record.sections, "next") || record.nextAction || "Sıradaki adımı netleştir.";

  return [
    `${toolName} için devam prompt'u:`,
    "",
    `Bu çalışma hattını devral. Proje: ${record.project || "belirsiz"}. Repo: ${record.repo || "belirsiz"}.`,
    "",
    `Amaç: ${goal}`,
    "",
    `Son oturumda olanlar:\n${happened}`,
    "",
    `Kararlar:\n${decisions}`,
    "",
    `Sıradaki adım:\n${next}`,
    "",
    "Önce mevcut repo durumunu oku, sonra yalnızca bu hedefle ilgili değişiklikleri öner veya uygula. Bağlam eksikse açıkça belirt."
  ].join("\n");
}

export function buildDecisionFromSession(session) {
  const decisions = getSection(session.sections, "decisions");
  if (!hasMeaningfulDecisionText(decisions)) return null;
  const decisionId = `dec_${slugify(session.id)}`;
  const content = `${serializeFrontmatter({
    id: decisionId,
    title: `${session.project || session.title} karar kaydı`,
    project: session.project || "",
    source_session: session.id,
    created_at: new Date().toISOString()
  })}

## Karar
${decisions}

## Kaynak
- ${session.path}
`;
  return { id: decisionId, path: `decisions/${decisionId}.md`, content };
}

function hasMeaningfulDecisionText(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toLocaleLowerCase("tr-TR")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*-]+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[.!?]+$/g, "")
    .trim();
  return ![
    "",
    "yok",
    "karar yok",
    "kayitli karar yok",
    "kayitli karar bulunmuyor",
    "karar kaydi yok",
    "n/a",
    "na"
  ].includes(normalized);
}

export function buildManualDecision(draft, now = new Date()) {
  const title = String(draft.title || "").trim();
  const decision = String(draft.decision || "").trim();
  if (!title) throw new Error("Karar başlığı boş olamaz.");
  if (!decision) throw new Error("Karar metni boş olamaz.");

  const stamp = timestampSlug(now);
  const decisionId = draft.id || `dec_${stamp}_${slugify(title)}`;
  const tags = normalizeArray(draft.tags);
  const content = `${serializeFrontmatter({
    id: decisionId,
    title,
    project: draft.project || "",
    source: "manual",
    source_work_item: draft.workItemId || "",
    created_at: now.toISOString(),
    tags
  })}

## Karar
${formatSectionText(decision)}

## Gerekçe
${formatSectionText(draft.rationale || "Gerekçe kaydı yok.")}

## Etki
${formatSectionText(draft.impact || "Etkisi daha sonra netleştirilecek.")}

## Kaynak
${formatSectionText(draft.source || "Manuel karar kaydı.")}
`;

  return {
    id: decisionId,
    path: `decisions/${decisionId}.md`,
    content
  };
}
