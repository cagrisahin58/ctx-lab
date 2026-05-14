import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell, Tray } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunnerPaths } from "../scripts/ctxlab-runner.mjs";
import { createDesktopRuntime, registerDesktopIpcHandlers } from "./runtime.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isSmoke = process.argv.includes("--smoke");
const isOffscreenFlow = process.env.CTX_LAB_ELECTRON_OFFSCREEN_WINDOW === "1";
const appIconPath = join(__dirname, "assets", "icon.ico");

let mainWindow;
let tray;

app.setName("ctx-lab");
if (process.env.CTX_LAB_ELECTRON_USER_DATA) {
  app.setPath("userData", process.env.CTX_LAB_ELECTRON_USER_DATA);
}

function createMenu() {
  const template = [
    {
      label: "ctx-lab",
      submenu: [
        { role: "about", label: "ctx-lab Hakkında" },
        { type: "separator" },
        { role: "quit", label: "Çıkış" }
      ]
    },
    {
      label: "Görünüm",
      submenu: [
        { role: "reload", label: "Yenile" },
        { role: "toggleDevTools", label: "Geliştirici Araçları" },
        { type: "separator" },
        { role: "resetZoom", label: "Yaklaşımı Sıfırla" },
        { role: "zoomIn", label: "Yaklaş" },
        { role: "zoomOut", label: "Uzaklaş" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tam Ekran" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const image = nativeImage.createFromPath(appIconPath);
  if (image.isEmpty()) return;
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("ctx-lab");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "ctx-lab'i Aç", click: () => mainWindow?.show() },
    { type: "separator" },
    { role: "quit", label: "Çıkış" }
  ]));
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: isOffscreenFlow ? 1680 : 1480,
    height: isOffscreenFlow ? 1040 : 940,
    minWidth: 1180,
    minHeight: 760,
    ...(isOffscreenFlow ? { x: -32000, y: -32000 } : {}),
    title: "ctx-lab",
    backgroundColor: "#0b1020",
    icon: appIconPath,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (openAllowedExternalUrl(url)) shell.openExternal(url);
    }
  });

  if (!isSmoke) {
    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });
  }

  mainWindow.webContents.once("did-finish-load", () => {
    if (isSmoke) {
      console.log("desktop app loaded");
      app.quit();
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "..", "dist", "index.html"));
  }
}

function isAppUrl(url) {
  if (isDev && process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) return true;
  return url.startsWith("file://");
}

function openAllowedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    const allowedHosts = new Set(["github.com", "claude.ai"]);
    return parsed.protocol === "https:" && allowedHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  const paths = buildRunnerPaths(app.getPath("userData"));
  const runtime = createDesktopRuntime({
    paths,
    dialog,
    mockProjectDirectory: process.env.CTX_LAB_ELECTRON_PROJECT_DIR || "",
    mockCodexVersion: process.env.CTX_LAB_ELECTRON_MOCK_CODEX_VERSION || "",
    mockCodexCommand: process.env.CTX_LAB_ELECTRON_MOCK_CODEX_COMMAND || "",
    mockMemoryFixtureFile: process.env.CTX_LAB_ELECTRON_MEMORY_FIXTURE || ""
  });
  registerDesktopIpcHandlers(ipcMain, runtime);
  createMenu();
  createTray();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
