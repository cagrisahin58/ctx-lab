const SECTION_ALIASES = {
  goal: ["Goal", "Amaç", "Hedef"],
  happened: ["What Happened", "Yapılanlar", "Ne Oldu"],
  decisions: ["Decisions", "Kararlar"],
  questions: ["Open Questions", "Açık Sorular", "Sorular"],
  next: ["Next Action", "Next Actions", "Sonraki Adım", "Sonraki Adımlar", "Sıradaki İş", "Sıradaki İşler"],
  evidence: ["Evidence", "Kanıtlar", "Kaynaklar"],
  objective: ["Objective", "Amaç"],
  current: ["Current State", "Güncel Durum"],
  risks: ["Risks / Blockers", "Riskler / Engeller", "Engeller"]
};

export const VALID_TYPES = ["inbox", "work_items", "decisions", "handoffs", "archive"];
export const VALID_STATUSES = ["needs_triage", "linked", "active", "waiting", "blocked", "done", "archived"];
export const WORK_STATUSES = ["active", "waiting", "blocked", "done"];

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
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }
  const raw = content.slice(3, end).trim();
  const body = content.slice(end + 4).trimStart();
  return { frontmatter: parseYamlLite(raw), body };
}

export function parseYamlLite(raw) {
  const result = {};
  const lines = raw.split(/\r?\n/);
  let currentKey = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(parseScalar(listMatch[1]));
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
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
  const { frontmatter, body } = parseFrontmatter(content);
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

export function validateMemoryRecords(records) {
  const warnings = [];
  const seen = new Map();

  for (const record of records) {
    if (!VALID_TYPES.includes(record.type)) {
      warnings.push(`${record.path}: bilinmeyen klasör tipi (${record.type})`);
    }
    if (!record.id) {
      warnings.push(`${record.path}: id alanı eksik`);
    }
    if (seen.has(record.id)) {
      warnings.push(`${record.path}: duplicate id (${record.id}), ilk kayıt: ${seen.get(record.id)}`);
    } else {
      seen.set(record.id, record.path);
    }
    if (!VALID_STATUSES.includes(record.status)) {
      warnings.push(`${record.path}: bilinmeyen durum (${record.status})`);
    }
    if (record.type === "inbox" && !record.source) {
      warnings.push(`${record.path}: inbox kaydı için source alanı eksik`);
    }
    if (record.type === "work_items" && !record.frontmatter.title) {
      warnings.push(`${record.path}: iş kartı için title alanı eksik`);
    }
  }

  return warnings;
}

function statusFromType(type) {
  if (type === "inbox") return "needs_triage";
  if (type === "archive") return "archived";
  return "active";
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
    : session.title.replace(/^Session Summary$/i, "Yeni çalışma hattı");

  const content = `${serializeFrontmatter({
    id: workId,
    title,
    project: session.project || "",
    status: "active",
    priority: "normal",
    updated_at: now,
    sessions: [session.id],
    decisions: []
  })}

## Objective
${getSection(session.sections, "goal") || session.summary || "Bu işin amacı netleştirilecek."}

## Current State
${getSection(session.sections, "happened") || "İlk oturum özeti iş kartına bağlandı."}

## Next Action
${getSection(session.sections, "next") || "Bir sonraki somut adım belirlenecek."}

## Risks / Blockers
${getSection(session.sections, "questions") || "Bilinen engel yok."}

## Best Handoff Prompt
${generateHandoffPrompt(session, "codex")}
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

export function updateWorkItemStatusContent(workItem, status, now = new Date()) {
  if (!WORK_STATUSES.includes(status)) {
    throw new Error(`Geçersiz iş kartı durumu: ${status}`);
  }
  return replaceFrontmatter(workItem.raw, {
    status,
    updated_at: now.toISOString()
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
  if (!base) return `${toolName} için context pack üretilecek kayıt bulunamadı.`;

  const latestSession = sessions[0] || (base.type === "inbox" ? base : null);
  const objective = getSection(base.sections, "objective") || getSection(base.sections, "goal") || base.summary || base.title;
  const current = getSection(base.sections, "current") || getSection(latestSession?.sections || {}, "happened") || base.summary || "Güncel durum kayıtlardan net çıkarılamadı.";
  const next = getSection(base.sections, "next") || getSection(latestSession?.sections || {}, "next") || "Sıradaki somut adım kayıtlardan net çıkarılamadı.";
  const risks = getSection(base.sections, "risks") || getSection(latestSession?.sections || {}, "questions") || "Kayıtlı risk veya açık soru yok.";

  return [
    `${toolName} için ctx-lab context pack`,
    "",
    `İş hattı: ${base.title}`,
    `Proje: ${base.project || "belirsiz"}`,
    `Repo: ${base.repo || latestSession?.repo || "belirsiz"}`,
    `Branch: ${base.branch || latestSession?.branch || "belirsiz"}`,
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
    `Açık iş: ${workItems.length} | Engelli: ${blockedCount} | Beklemede: ${waitingCount} | Triage bekleyen inbox: ${triageCount}`,
    "",
    "Öncelikli işler:",
    workItems.length ? workItems.slice(0, 10).map((workItem, index) => formatWorkBrief(records, workItem, index)).join("\n") : "- Açık iş kaydı yok.",
    "",
    "Triage:",
    triageCount ? `- ${triageCount} inbox kaydı işlenmeyi bekliyor.` : "- Triage bekleyen inbox kaydı yok.",
    "",
    "Çalışma kuralı:",
    "Önce repo durumunu ve seçili iş hattının context pack'ini oku. Kayıtlarda olmayan karar, dosya, commit veya metrik uydurma."
  ].join("\n");
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

# Session Summary

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
  const body = parsed.body.trim() || defaultSessionBody();
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

# Session Summary

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
  return `# Session Summary

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

function formatSectionText(value) {
  const text = String(value).trim();
  if (!text) return "";
  if (text.includes("\n") || text.startsWith("- ")) return text;
  return text;
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
  if (!decisions.trim()) return null;
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
