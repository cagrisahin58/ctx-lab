#[derive(Debug, Clone, PartialEq)]
pub enum Theme {
    Dark,
    Light,
}

#[derive(Debug, Clone, PartialEq)]
pub enum View {
    Dashboard,
    Project(String),
    Session { project_id: String, session_id: String },
    Settings,
    Overview,
}
