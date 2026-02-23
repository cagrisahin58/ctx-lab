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
mod utils;

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
        std::process::exit(0); // Never block Claude Code
    }
}
