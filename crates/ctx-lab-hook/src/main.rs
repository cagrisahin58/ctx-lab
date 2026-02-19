use clap::{Parser, Subcommand};

mod checkpoint;
mod doctor;
mod event_bridge;
mod install;
mod process_queue;
mod session_end;
mod session_start;
mod stop;
mod uninstall;

#[derive(Parser)]
#[command(name = "ctx-lab-hook", version, about = "ctx-lab Claude Code hook binary")]
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
    };
    if let Err(e) = result {
        eprintln!("[ctx-lab] ERROR: {}", e);
        std::process::exit(0); // Never block Claude Code
    }
}
