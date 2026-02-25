use clap::{Parser, Subcommand};

mod checkpoint;
mod doctor;
mod event_bridge;
mod install;
mod process_queue;
mod session_end;
mod session_start;
mod stop;
mod summary;
mod uninstall;

#[derive(Parser)]
#[command(name = "seslog", version, about = "Seslog Claude Code hook binary")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    SessionStart,
    Checkpoint,
    Stop,
    SessionEnd,
    Install,
    Uninstall,
    Doctor,
    ProcessQueue,
    Summary {
        #[arg()]
        text: String,
    },
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::SessionStart => session_start::run(),
        Commands::Checkpoint => checkpoint::run(),
        Commands::Stop => stop::run(),
        Commands::SessionEnd => session_end::run(),
        Commands::Install => install::run(),
        Commands::Uninstall => uninstall::run(),
        Commands::Doctor => doctor::run(),
        Commands::ProcessQueue => process_queue::run(),
        Commands::Summary { text } => summary::run(&text),
    };
    if let Err(e) = result {
        eprintln!("[seslog] ERROR: {}", e);
        // Log error to file for debugging
        if let Some(data_dir) = dirs::data_local_dir() {
            let log_path = data_dir.join("seslog").join("error.log");
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let log_entry = format!("[{}] ERROR: {}\n", timestamp, e);
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .and_then(|mut f| {
                    use std::io::Write;
                    f.write_all(log_entry.as_bytes())
                });
        }
        std::process::exit(0); // Never block Claude Code
    }
}
