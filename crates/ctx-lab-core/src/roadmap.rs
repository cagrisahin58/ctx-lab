use regex::Regex;
use once_cell::sync::Lazy;

#[derive(Debug, Clone)]
pub struct RoadmapItem {
    pub status: ItemStatus,
    pub text: String,
    pub phase: Option<String>,
    pub line_number: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ItemStatus {
    Done,       // [x]
    Active,     // [>]
    Pending,    // [ ]
    Suspended,  // [~]
    Blocked,    // [!]
}

static ITEM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^-\s+\[([ x>~!])\]\s+(.+)$").unwrap());
static PHASE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^##\s+(.+)$").unwrap());

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
            items.push(RoadmapItem {
                status, text: caps[2].trim().to_string(),
                phase: current_phase.clone(), line_number: idx + 1,
            });
        }
    }
    items
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
            if caps[2].trim() == item_text {
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
}
