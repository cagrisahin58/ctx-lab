use regex::Regex;
use once_cell::sync::Lazy;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct RoadmapItem {
    pub status: ItemStatus,
    pub text: String,
    pub phase: Option<String>,
    pub line_number: usize,
    pub id: Option<String>,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RoadmapData {
    pub items: Vec<RoadmapItem>,
    pub progress_percent: f32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Done,       // [x]
    Active,     // [>]
    Pending,    // [ ]
    Suspended,  // [~]
    Blocked,    // [!]
}

// Step 1: Capture checkbox + full remaining text
static ITEM_RE: Lazy<Regex> = Lazy::new(||
    Regex::new(r"^-\s+\[([ x>~!])\]\s+(.+?)\s*$").unwrap()
);

// Step 2: Only match trailing {…} if it contains id: or depends: keywords
static ATTR_RE: Lazy<Regex> = Lazy::new(||
    Regex::new(r"\s*\{((?:id|depends)\s*:[^}]*)\}\s*$").unwrap()
);

static PHASE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^##\s+(.+)$").unwrap());

/// Parse attribute block content like "id: train, depends: preprocess"
/// into (Option<id>, Vec<depends>).
fn parse_attributes(attr_str: &str) -> (Option<String>, Vec<String>) {
    let mut id = None;
    let mut depends = Vec::new();

    // Split by comma, but be careful: "depends: a, b" means depends on both a and b
    // We need to split by the keyword boundaries, not just commas.
    // Strategy: find "id:" and "depends:" tokens, then collect their values.

    // First, find where each keyword starts
    let attr_str = attr_str.trim();

    // Split on keyword boundaries: split on "id:" or "depends:"
    // We'll iterate through and extract values.
    let mut remaining = attr_str;

    while !remaining.is_empty() {
        remaining = remaining.trim_start_matches(|c: char| c == ',' || c.is_whitespace());
        if remaining.is_empty() {
            break;
        }

        if let Some(rest) = remaining.strip_prefix("id:") {
            // Collect value until next keyword or end
            let value_end = rest.find("depends:").unwrap_or(rest.len());
            let value = rest[..value_end].trim().trim_end_matches(',').trim();
            if !value.is_empty() {
                id = Some(value.to_string());
            }
            remaining = &rest[value_end..];
        } else if let Some(rest) = remaining.strip_prefix("depends:") {
            // Collect comma-separated values until next keyword or end
            let value_end = rest.find("id:").unwrap_or(rest.len());
            let values_str = rest[..value_end].trim().trim_end_matches(',').trim();
            for val in values_str.split(',') {
                let v = val.trim();
                if !v.is_empty() {
                    depends.push(v.to_string());
                }
            }
            remaining = &rest[value_end..];
        } else {
            // Unknown token, skip to next comma or end
            if let Some(pos) = remaining.find(',') {
                remaining = &remaining[pos + 1..];
            } else {
                break;
            }
        }
    }

    (id, depends)
}

pub fn parse_roadmap(content: &str) -> Vec<RoadmapItem> {
    let mut items = Vec::new();
    let mut current_phase: Option<String> = None;
    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if let Some(caps) = PHASE_RE.captures(trimmed) {
            current_phase = Some(caps[1].to_string());
            continue;
        }
        if let Some(caps) = ITEM_RE.captures(trimmed) {
            let status = match &caps[1] {
                "x" => ItemStatus::Done,
                ">" => ItemStatus::Active,
                " " => ItemStatus::Pending,
                "~" => ItemStatus::Suspended,
                "!" => ItemStatus::Blocked,
                _ => continue,
            };
            let full_text = caps[2].to_string();

            // Two-pass: try to extract trailing {id:..., depends:...} block
            let (text, id, depends_on) = if let Some(attr_caps) = ATTR_RE.captures(&full_text) {
                let attr_match = attr_caps.get(0).unwrap();
                let text_part = full_text[..attr_match.start()].trim().to_string();
                let (id, depends) = parse_attributes(&attr_caps[1]);
                (text_part, id, depends)
            } else {
                (full_text.trim().to_string(), None, Vec::new())
            };

            items.push(RoadmapItem {
                status, text,
                phase: current_phase.clone(), line_number: idx + 1,
                id, depends_on,
            });
        }
    }
    items
}

/// Validate that all dependency references point to existing item ids.
/// Returns a list of warning strings for any broken references.
pub fn validate_dependencies(items: &[RoadmapItem]) -> Vec<String> {
    let known_ids: HashSet<&str> = items.iter()
        .filter_map(|i| i.id.as_deref())
        .collect();

    let mut warnings = Vec::new();
    for item in items {
        for dep in &item.depends_on {
            if !known_ids.contains(dep.as_str()) {
                let item_label = item.id.as_deref().unwrap_or(&item.text);
                warnings.push(format!(
                    "Item '{}' depends on '{}' which does not exist",
                    item_label, dep
                ));
            }
        }
    }
    warnings
}

/// Parse roadmap content and return a complete RoadmapData with items,
/// progress percentage, and dependency validation warnings.
pub fn parse_roadmap_data(content: &str) -> RoadmapData {
    let items = parse_roadmap(content);
    let total = items.len() as f32;
    let progress_percent = if total == 0.0 {
        0.0
    } else {
        let done = items.iter().filter(|i| i.status == ItemStatus::Done).count() as f32;
        (done / total * 100.0).round()
    };
    let warnings = validate_dependencies(&items);
    RoadmapData { items, progress_percent, warnings }
}

pub fn active_item(content: &str) -> Option<RoadmapItem> {
    parse_roadmap(content).into_iter().find(|i| i.status == ItemStatus::Active)
}

pub fn progress_percent(content: &str) -> f32 {
    let items = parse_roadmap(content);
    let total = items.len() as f32;
    if total == 0.0 { return 0.0; }
    let done = items.iter().filter(|i| i.status == ItemStatus::Done).count() as f32;
    (done / total * 100.0).round()
}

pub fn mark_complete(content: &str, item_text: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut found_line: Option<usize> = None;
    for (idx, line) in lines.iter().enumerate() {
        if let Some(caps) = ITEM_RE.captures(line.trim()) {
            // Strip attributes from captured text for comparison
            let full_text = caps[2].to_string();
            let clean_text = if let Some(attr_match) = ATTR_RE.find(&full_text) {
                full_text[..attr_match.start()].trim().to_string()
            } else {
                full_text.trim().to_string()
            };
            if clean_text == item_text {
                found_line = Some(idx);
                break;
            }
        }
    }
    let target_line = found_line?;
    let mut new_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    new_lines[target_line] = ITEM_RE.replace(&new_lines[target_line], "- [x] $2").to_string();
    for line in new_lines.iter_mut().skip(target_line + 1) {
        if let Some(caps) = ITEM_RE.captures(line.trim()) {
            if &caps[1] == " " {
                *line = ITEM_RE.replace(line, "- [>] $2").to_string();
                break;
            }
        }
    }
    Some(new_lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ROADMAP: &str = "\
# Project Roadmap

## Phase 1: Data Prep
- [x] Download dataset
- [x] Clean data
- [>] Feature engineering
- [ ] Train/test split

## Phase 2: Modeling
- [ ] Baseline model
- [ ] Hyperparameter tuning
";

    #[test]
    fn test_parse_roadmap_item_count() {
        assert_eq!(parse_roadmap(SAMPLE_ROADMAP).len(), 6);
    }

    #[test]
    fn test_parse_roadmap_statuses() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items[0].status, ItemStatus::Done);
        assert_eq!(items[1].status, ItemStatus::Done);
        assert_eq!(items[2].status, ItemStatus::Active);
        assert_eq!(items[3].status, ItemStatus::Pending);
    }

    #[test]
    fn test_parse_roadmap_text() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items[0].text, "Download dataset");
        assert_eq!(items[2].text, "Feature engineering");
    }

    #[test]
    fn test_parse_roadmap_phases() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items[0].phase.as_deref(), Some("Phase 1: Data Prep"));
        assert_eq!(items[4].phase.as_deref(), Some("Phase 2: Modeling"));
    }

    #[test]
    fn test_active_item() {
        let item = active_item(SAMPLE_ROADMAP);
        assert!(item.is_some());
        assert_eq!(item.unwrap().text, "Feature engineering");
    }

    #[test]
    fn test_progress_percent() {
        let pct = progress_percent(SAMPLE_ROADMAP);
        assert!((pct - 33.0).abs() < 1.0);
    }

    #[test]
    fn test_mark_complete_moves_active() {
        let result = mark_complete(SAMPLE_ROADMAP, "Feature engineering");
        assert!(result.is_some());
        let updated = result.unwrap();
        assert!(updated.contains("- [x] Feature engineering"));
        assert!(updated.contains("- [>] Train/test split"));
    }

    #[test]
    fn test_mark_complete_nonexistent_returns_none() {
        assert!(mark_complete(SAMPLE_ROADMAP, "Nonexistent").is_none());
    }

    #[test]
    fn test_empty_roadmap() {
        assert_eq!(parse_roadmap("").len(), 0);
        assert!(active_item("").is_none());
        assert_eq!(progress_percent(""), 0.0);
    }

    #[test]
    fn test_suspended_and_blocked_statuses() {
        let md = "- [~] Paused task\n- [!] Blocked task\n";
        let items = parse_roadmap(md);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].status, ItemStatus::Suspended);
        assert_eq!(items[1].status, ItemStatus::Blocked);
    }

    // -----------------------------------------------------------------------
    // New tests for branching roadmap features
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_item_with_id() {
        let items = parse_roadmap("## Phase\n- [>] Train model {id: train}");
        assert_eq!(items[0].id, Some("train".into()));
        assert_eq!(items[0].text, "Train model");
    }

    #[test]
    fn test_parse_item_with_depends() {
        let items = parse_roadmap("## P\n- [x] A {id: a}\n- [ ] B {id: b, depends: a}");
        assert_eq!(items[1].depends_on, vec!["a"]);
    }

    #[test]
    fn test_validate_deps_missing_id() {
        let data = parse_roadmap_data("- [ ] A {depends: nonexistent}");
        assert_eq!(data.warnings.len(), 1);
    }

    #[test]
    fn test_backward_compat_no_attrs() {
        let items = parse_roadmap("- [x] Simple item without attributes");
        assert_eq!(items[0].id, None);
        assert!(items[0].depends_on.is_empty());
    }

    #[test]
    fn test_code_braces_not_parsed_as_attributes() {
        let items = parse_roadmap("- [ ] Implement {HashMap} cache");
        assert_eq!(items[0].id, None);
        assert!(items[0].depends_on.is_empty());
        assert_eq!(items[0].text, "Implement {HashMap} cache");
    }

    #[test]
    fn test_mixed_braces_only_attrs_stripped() {
        let items = parse_roadmap("- [ ] Use {HashMap} for lookup {id: cache}");
        assert_eq!(items[0].id, Some("cache".into()));
        assert_eq!(items[0].text, "Use {HashMap} for lookup");
    }

    #[test]
    fn test_multiple_depends() {
        let md = "- [x] A {id: a}\n- [x] B {id: b}\n- [ ] C {id: c, depends: a, b}";
        let items = parse_roadmap(md);
        assert_eq!(items[2].depends_on, vec!["a", "b"]);
    }

    #[test]
    fn test_validate_deps_all_valid() {
        let md = "- [x] A {id: a}\n- [ ] B {id: b, depends: a}";
        let data = parse_roadmap_data(md);
        assert!(data.warnings.is_empty());
    }

    #[test]
    fn test_parse_roadmap_data_progress() {
        let data = parse_roadmap_data("- [x] Done\n- [ ] Todo");
        assert!((data.progress_percent - 50.0).abs() < 1.0);
    }

    #[test]
    fn test_mark_complete_with_attrs() {
        let md = "- [>] Train model {id: train}\n- [ ] Evaluate {id: eval, depends: train}";
        let result = mark_complete(md, "Train model");
        assert!(result.is_some());
        let updated = result.unwrap();
        assert!(updated.contains("- [x] Train model {id: train}"));
        assert!(updated.contains("- [>] Evaluate {id: eval, depends: train}"));
    }

    #[test]
    fn test_branching_roadmap_fixture() {
        let fixture = include_str!("../../../tests/fixtures/branching_roadmap.md");
        let data = parse_roadmap_data(fixture);

        // 8 items total across 3 phases
        assert_eq!(data.items.len(), 8);

        // Check ids are parsed
        assert_eq!(data.items[0].id, Some("data".into()));
        assert_eq!(data.items[2].id, Some("train".into()));
        assert_eq!(data.items[6].id, Some("compare".into()));

        // Check depends
        assert_eq!(data.items[1].depends_on, vec!["data"]);
        assert_eq!(data.items[6].depends_on, vec!["hpsearch", "distill"]);
        assert_eq!(data.items[7].depends_on, vec!["eval", "compare"]);

        // All dependencies are valid
        assert!(data.warnings.is_empty(), "warnings: {:?}", data.warnings);

        // 2 done out of 8 => 25%
        assert!((data.progress_percent - 25.0).abs() < 1.0);

        // Active item
        let active = data.items.iter().find(|i| i.status == ItemStatus::Active);
        assert!(active.is_some());
        assert_eq!(active.unwrap().text, "Train baseline model");
    }
}
