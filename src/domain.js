const SECTION_ALIASES = {
  goal: ["Goal", "Amaç", "Hedef"],
  happened: ["What Happened", "Yapılanlar", "Ne Oldu"],
  decisions: ["Decisions", "Kararlar"],
  questions: ["Open Questions", "Açık Sorular", "Sorular"],
  next: ["Next Actions", "Sonraki Adımlar", "Sıradaki İşler"],
  evidence: ["Evidence", "Kanıtlar", "Kaynaklar"],
  objective: ["Objective", "Amaç"],
  current: ["Current State", "Güncel Durum"],
  risks: ["Risks / Blockers", "Riskler / Engeller", "Engeller"]
};

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
