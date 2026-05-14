const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
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

contextBridge.exposeInMainWorld("ctxLabDesktop", {
  isDesktop: true,
  runnerHealth: () => ipcRenderer.invoke(channels.health),
  runnerProjects: () => ipcRenderer.invoke(channels.listProjects),
  registerProject: (project) => ipcRenderer.invoke(channels.registerProject, project),
  selectProjectDirectory: () => ipcRenderer.invoke(channels.selectProjectDirectory),
  runnerRuns: (options) => ipcRenderer.invoke(channels.listRuns, options || {}),
  runnerRunEvents: (options) => ipcRenderer.invoke(channels.runEvents, options || {}),
  startCodexRun: (run) => ipcRenderer.invoke(channels.startCodexRun, run),
  memoryStatus: (config) => ipcRenderer.invoke(channels.memoryStatus, config || {}),
  memoryIndex: (config) => ipcRenderer.invoke(channels.memoryIndex, config || {}),
  syncMemory: (config) => ipcRenderer.invoke(channels.syncMemory, config || {})
});
