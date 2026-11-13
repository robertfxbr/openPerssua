// Janela overlay always-on-top com click-through.
// Reimplementa o comportamento observado nos canais originais:
// `set-always-on-top`, `click-through-toggled`, `set-overlay-surface-mode`,
// `move-window-to-display`, `recalculate-overlay-window-shape`.

const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindow = null;
let compactMode = false; // não persistir o tamanho da pílula como tamanho padrão

// Modo fantasma. hidden: a janela some de compartilhamento de tela, gravação
// e print (no Windows 10 2004+ vira WDA_EXCLUDEFROMCAPTURE: quem assiste vê o
// que está atrás dela). clickThrough: o mouse atravessa a janela.
let ghost = { hidden: false, clickThrough: false };

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
    // "toolbar" no Windows = WS_EX_TOOLWINDOW: a janela não ganha botão na
    // barra de tarefas nem aparece no Alt+Tab, mesmo depois de esconder e
    // mostrar de novo.
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    resizable: true,
    hasShadow: false,
    // marca do Teka no Alt+Tab (o ícone do .exe vem do instalador)
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
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

  // Proteção de captura e click-through conforme o modo fantasma
  applyGhost(overlayWindow);

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
  else { win.show(); win.setSkipTaskbar(true); win.focus(); }
}

function applyGhost(win = getOverlayWindow()) {
  if (!win || win.isDestroyed()) return;
  win.setContentProtection(ghost.hidden);
  win.setIgnoreMouseEvents(ghost.clickThrough, { forward: true });
}

// Recebe só os campos que mudam e devolve o estado completo.
function setGhost(patch = {}) {
  if (typeof patch.hidden === 'boolean') ghost = { ...ghost, hidden: patch.hidden };
  if (typeof patch.clickThrough === 'boolean') ghost = { ...ghost, clickThrough: patch.clickThrough };
  applyGhost();
  const win = getOverlayWindow();
  if (win && !win.webContents.isDestroyed()) win.webContents.send('overlay:ghost-changed', { ...ghost });
  return { ...ghost };
}

function getGhost() {
  return { ...ghost };
}

function setClickThrough(enabled) {
  setGhost({ clickThrough: Boolean(enabled) });
}

// Bug conhecido do Electron no Windows: janela transparente não repinta
// após resize ou mudança de monitor programática. invalidate força a
// repintura, e o ciclo opacity 0.99 -> 1 derruba o cache de superfície do DWM.
function repaintOverlay(win = getOverlayWindow()) {
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.invalidate();
    win.setOpacity(0.99);
    setTimeout(() => { if (!win.isDestroyed()) win.setOpacity(1); }, 40);
  }, 80);
}

// Movimentos feitos pelo código (trocar de monitor) não disparam 'moved'
// no Windows, então a posição nova é salva explicitamente.
function persistWindowState() {
  const win = getOverlayWindow();
  if (win) saveWindowState(win);
}

module.exports = {
  createOverlayWindow,
  getOverlayWindow,
  toggleOverlay,
  setClickThrough,
  setGhost,
  getGhost,
  setCompactMode,
  repaintOverlay,
  persistWindowState,
};
