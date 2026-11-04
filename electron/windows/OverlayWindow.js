// Janela overlay always-on-top com click-through.
// Reimplementa o comportamento observado nos canais originais:
// `set-always-on-top`, `click-through-toggled`, `set-overlay-surface-mode`,
// `move-window-to-display`, `recalculate-overlay-window-shape`.

const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindow = null;
let compactMode = false; // não persistir o tamanho da pílula como tamanho padrão

function setCompactMode(enabled) {
  compactMode = Boolean(enabled);
}

// Posição/tamanho persistidos: o overlay reabre onde o usuário deixou
function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    // Garante que a janela ainda está dentro de alguma tela atual
    const onScreen = screen.getAllDisplays().some((d) =>
      s.x >= d.workArea.x - 8 && s.y >= d.workArea.y - 8
      && s.x < d.workArea.x + d.workArea.width
      && s.y < d.workArea.y + d.workArea.height);
    if (onScreen && s.width >= 280 && s.height >= 120) return s;
  } catch { /* sem estado salvo */ }
  return null;
}

function saveWindowState(win) {
  if (compactMode) return; // tamanho do modo mini não vira o padrão
  try {
    fs.writeFileSync(statePath(), JSON.stringify(win.getBounds()));
  } catch { /* falha em salvar posição não é crítica */ }
}

function createOverlayWindow({ isDev }) {
  const primary = screen.getPrimaryDisplay();
  const { width } = primary.workAreaSize;
  const saved = loadWindowState();

  overlayWindow = new BrowserWindow({
    width: saved?.width || 420,
    height: saved?.height || 640,
    x: saved?.x ?? width - 440,
    y: saved?.y ?? 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Fica visível sobre apps em fullscreen (macOS Spaces / Windows)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through desligado por padrão; renderer alterna via ipc
  overlayWindow.setIgnoreMouseEvents(false);

  // Persiste posição/tamanho ao arrastar ou redimensionar
  overlayWindow.on('moved', () => saveWindowState(overlayWindow));
  overlayWindow.on('resized', () => saveWindowState(overlayWindow));

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

function getOverlayWindow() {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null;
}

function toggleOverlay(isDev) {
  const win = getOverlayWindow() || createOverlayWindow({ isDev });
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

function setClickThrough(enabled) {
  const win = getOverlayWindow();
  if (win) win.setIgnoreMouseEvents(enabled, { forward: true });
}

module.exports = { createOverlayWindow, getOverlayWindow, toggleOverlay, setClickThrough, setCompactMode };
