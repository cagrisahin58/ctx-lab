import {
  buildHealthPayload,
  buildRunnerPaths,
  getMemoryMirrorStatus,
  listCodexRunEvents,
  listCodexRuns,
  readProjectRegistry,
  registerProject,
  readMemoryIndex,
  syncMemoryMirror,
  startCodexRun
} from "../scripts/ctxlab-runner.mjs";

export const DESKTOP_IPC_CHANNELS = Object.freeze({
  health: "ctxlab:runner:health",
  listProjects: "ctxlab:projects:list",
  registerProject: "ctxlab:projects:register",
  selectProjectDirectory: "ctxlab:projects:select-directory",
  listRuns: "ctxlab:runs:list",
  runEvents: "ctxlab:runs:events",
  startCodexRun: "ctxlab:runs:start-codex",
  memoryStatus: "ctxlab:memory:status",
  memoryIndex: "ctxlab:memory:index",
  syncMemory: "ctxlab:memory:sync"
});

export function createDesktopRuntime(options = {}) {
  const paths = options.paths || buildRunnerPaths(options.appDataDir);
  const dialog = options.dialog;
  const mockProjectDirectory = options.mockProjectDirectory;

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
      if (mockProjectDirectory) {
        return { canceled: false, path: mockProjectDirectory };
      }
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
    async runEvents(input = {}) {
      return listCodexRunEvents(paths, input);
    },
    async startCodexRun(input) {
      return startCodexRun(paths, input, options);
    },
    async memoryStatus(input) {
      return getMemoryMirrorStatus(paths, input);
    },
    async memoryIndex(input) {
      return readMemoryIndex(paths, input);
    },
    async syncMemory(input) {
      return syncMemoryMirror(paths, input, options);
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
    [DESKTOP_IPC_CHANNELS.runEvents]: (_event, input) => runtime.runEvents(input),
    [DESKTOP_IPC_CHANNELS.startCodexRun]: (_event, input) => runtime.startCodexRun(input),
    [DESKTOP_IPC_CHANNELS.memoryStatus]: (_event, input) => runtime.memoryStatus(input),
    [DESKTOP_IPC_CHANNELS.memoryIndex]: (_event, input) => runtime.memoryIndex(input),
    [DESKTOP_IPC_CHANNELS.syncMemory]: (_event, input) => runtime.syncMemory(input)
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }

  return Object.keys(handlers);
}
