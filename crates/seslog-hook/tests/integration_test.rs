use std::process::Command;

/// Helper to get the built binary path
fn binary_path() -> String {
    // CARGO_MANIFEST_DIR points to crates/seslog-hook/
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let workspace_root = std::path::Path::new(manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    let target_dir = std::env::var("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| workspace_root.join("target"));

    let binary = target_dir.join("debug").join("seslog");

    // Build if not present
    if !binary.exists() {
        let output = Command::new("cargo")
            .args(["build", "-p", "seslog"])
            .current_dir(workspace_root)
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    std::env::var("HOME").unwrap() + "/.cargo/bin",
                    std::env::var("PATH").unwrap_or_default()
                ),
            )
            .output()
            .expect("cargo build failed");
        assert!(
            output.status.success(),
            "Build failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    binary.to_string_lossy().to_string()
}

#[test]
fn test_help_shows_all_subcommands() {
    let binary = binary_path();
    let output = Command::new(&binary)
        .arg("--help")
        .output()
        .expect("binary execution failed");
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("session-start"), "missing session-start in help:\n{}", stdout);
    assert!(stdout.contains("checkpoint"), "missing checkpoint in help:\n{}", stdout);
    assert!(stdout.contains("stop"), "missing stop in help:\n{}", stdout);
    assert!(stdout.contains("session-end"), "missing session-end in help:\n{}", stdout);
    assert!(stdout.contains("install"), "missing install in help:\n{}", stdout);
    assert!(stdout.contains("uninstall"), "missing uninstall in help:\n{}", stdout);
    assert!(stdout.contains("doctor"), "missing doctor in help:\n{}", stdout);
    assert!(stdout.contains("process-queue"), "missing process-queue in help:\n{}", stdout);
}

#[test]
fn test_doctor_runs_without_panic() {
    let binary = binary_path();
    let output = Command::new(&binary)
        .arg("doctor")
        .output()
        .expect("doctor failed");
    // Doctor should always exit 0 (even with warnings)
    assert!(output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("seslog doctor report"),
        "doctor output missing expected header, got:\n{}",
        stderr
    );
}

#[test]
fn test_process_queue_empty() {
    let binary = binary_path();
    let output = Command::new(&binary)
        .arg("process-queue")
        .output()
        .expect("process-queue failed");
    assert!(output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Processing queue") || stderr.contains("Processed"),
        "process-queue output missing expected text, got:\n{}",
        stderr
    );
}
