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

#[derive(Debug, Clone, PartialEq)]
pub enum ToastKind {
    Success,
    Error,
    Info,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Toast {
    pub message: String,
    pub kind: ToastKind,
    pub id: u64,
}
