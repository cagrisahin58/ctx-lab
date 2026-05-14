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
  applyCodexRunCommit,
  startCodexRun
} from "../scripts/ctxlab-runner.mjs";
import { readFile } from "node:fs/promises";

export const DESKTOP_IPC_CHANNELS = Object.freeze({
  health: "ctxlab:runner:health",
  listProjects: "ctxlab:projects:list",
  registerProject: "ctxlab:projects:register",
  selectProjectDirectory: "ctxlab:projects:select-directory",
  listRuns: "ctxlab:runs:list",
  runEvents: "ctxlab:runs:events",
  startCodexRun: "ctxlab:runs:start-codex",
  applyRunCommit: "ctxlab:runs:apply-commit",
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
    async applyRunCommit(input) {
      return applyCodexRunCommit(paths, input, options);
    },
    async memoryStatus(input) {
      if (options.mockMemoryFixtureFile) {
        const index = await readMockMemoryFixture(options.mockMemoryFixtureFile, input);
        return {
          configured: true,
          owner: index.owner,
          repo: index.repo,
          branch: index.branch,
          remoteUrl: `https://github.com/${index.owner}/${index.repo}.git`,
          cloneDir: index.cloneDir || "",
          indexFile: options.mockMemoryFixtureFile,
          cloneExists: true,
          remoteCheck: {
            status: "ok",
            expectedRepo: `${index.owner}/${index.repo}`,
            expectedRemoteUrl: `https://github.com/${index.owner}/${index.repo}.git`,
            actualRepo: `${index.owner}/${index.repo}`,
            actualRemoteUrl: `https://github.com/${index.owner}/${index.repo}.git`,
            error: ""
          },
          error: "",
          indexed: true,
          recordCount: index.recordCount || index.records?.length || 0,
          warningCount: index.warningCount || 0,
          lastIndexedAt: index.indexedAt || "",
          lastCommit: index.lastCommit || ""
        };
      }
      return getMemoryMirrorStatus(paths, input);
    },
    async memoryIndex(input) {
      if (options.mockMemoryFixtureFile) {
        return readMockMemoryFixture(options.mockMemoryFixtureFile, input);
      }
      return readMemoryIndex(paths, input);
    },
    async syncMemory(input) {
      if (options.mockMemoryFixtureFile) {
        return readMockMemoryFixture(options.mockMemoryFixtureFile, input);
      }
      return syncMemoryMirror(paths, input, options);
    }
  };
}

async function readMockMemoryFixture(file, input = {}) {
  const index = JSON.parse(await readFile(file, "utf8"));
  return {
    ...index,
    owner: index.owner || input.owner || "",
    repo: index.repo || input.repo || "",
    branch: index.branch || input.branch || "main"
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
    [DESKTOP_IPC_CHANNELS.applyRunCommit]: (_event, input) => runtime.applyRunCommit(input),
    [DESKTOP_IPC_CHANNELS.memoryStatus]: (_event, input) => runtime.memoryStatus(input),
    [DESKTOP_IPC_CHANNELS.memoryIndex]: (_event, input) => runtime.memoryIndex(input),
    [DESKTOP_IPC_CHANNELS.syncMemory]: (_event, input) => runtime.syncMemory(input)
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }

  return Object.keys(handlers);
}
