import {
  buildHealthPayload,
  buildRunnerPaths,
  listCodexRuns,
  readProjectRegistry,
  registerProject,
  startCodexRun
} from "../scripts/ctxlab-runner.mjs";

export const DESKTOP_IPC_CHANNELS = Object.freeze({
  health: "ctxlab:runner:health",
  listProjects: "ctxlab:projects:list",
  registerProject: "ctxlab:projects:register",
  selectProjectDirectory: "ctxlab:projects:select-directory",
  listRuns: "ctxlab:runs:list",
  startCodexRun: "ctxlab:runs:start-codex"
});

export function createDesktopRuntime(options = {}) {
  const paths = options.paths || buildRunnerPaths(options.appDataDir);
  const dialog = options.dialog;

  return {
    paths,
    async health() {
      return buildHealthPayload(paths, options);
    },
    async listProjects() {
      return readProjectRegistry(paths);
    },
    async registerProject(input) {
      const project = await registerProject(paths, input, options);
      return { ok: true, project, registry: await readProjectRegistry(paths) };
    },
    async selectProjectDirectory() {
      if (!dialog?.showOpenDialog) {
        throw new Error("Klasor secici bu calisma ortaminda kullanilamiyor.");
      }
      const result = await dialog.showOpenDialog({
        title: "Proje kok klasorunu sec",
        properties: ["openDirectory", "createDirectory"]
      });
      return {
        canceled: result.canceled,
        path: result.filePaths?.[0] || ""
      };
    },
    async listRuns(input = {}) {
      return { runs: await listCodexRuns(paths, input.limit) };
    },
    async startCodexRun(input) {
      return startCodexRun(paths, input, options);
    }
  };
}

export function registerDesktopIpcHandlers(ipcMain, runtime) {
  const handlers = {
    [DESKTOP_IPC_CHANNELS.health]: () => runtime.health(),
    [DESKTOP_IPC_CHANNELS.listProjects]: () => runtime.listProjects(),
    [DESKTOP_IPC_CHANNELS.registerProject]: (_event, input) => runtime.registerProject(input),
    [DESKTOP_IPC_CHANNELS.selectProjectDirectory]: () => runtime.selectProjectDirectory(),
    [DESKTOP_IPC_CHANNELS.listRuns]: (_event, input) => runtime.listRuns(input),
    [DESKTOP_IPC_CHANNELS.startCodexRun]: (_event, input) => runtime.startCodexRun(input)
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }

  return Object.keys(handlers);
}
