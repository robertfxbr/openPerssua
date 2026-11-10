// OpenPerssua — bootstrap do processo principal.
// Versão enxuta do main.js original (que tem ~1.450 linhas, 11 janelas,
// flavors whitelabel, telemetria e updater). Aqui: overlay + tray.

const path = require('path');
const { app, clipboard, session, Tray, Menu, nativeImage } = require('electron');
const log = require('electron-log');

// Captura de áudio do sistema (loopback: Discord/Zoom/Meet) — o plugin
// pede initMain() ANTES do app ficar pronto.
const { initMain: initAudioLoopback } = require('electron-audio-loopback');
initAudioLoopback();

const {
  createOverlayWindow, getOverlayWindow, toggleOverlay, repaintOverlay, persistWindowState,
} = require('./windows/OverlayWindow');
const { registerIpc, disposeIpc } = require('./ipc');
const { DatabaseManager } = require('./db/DatabaseManager');
const { SettingsStore } = require('./settings/SettingsStore');
const { ShortcutManager } = require('./shortcuts/ShortcutManager');
const { moveToNextDisplay } = require('./system/displays');
const { openLogsFolder } = require('./system/logs');

const isDev = process.argv.includes('--dev');
log.initialize();

// Texto copiado maior que isso é cortado antes de ir ao overlay
const MAX_CLIPBOARD_CHARS = 20000;

let db = null;
let tray = null;
let shortcuts = null;

// Sem este handler, o Electron NEGA getUserMedia por padrão em apps empacotados
// e o microfone falha silenciosamente no renderer.
function configurePermissions() {
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

// Mostra o overlay (sem roubar foco) e avisa o renderer de uma ação de atalho
function sendToOverlay(channel, payload) {
  const win = getOverlayWindow();
  if (win && !win.webContents.isDestroyed()) {
    if (!win.isVisible()) win.showInactive();
    win.webContents.send(channel, payload);
  }
}

function moveOverlayToNextDisplay() {
  const r = moveToNextDisplay(getOverlayWindow());
  if (r.ok) { repaintOverlay(); persistWindowState(); }
  return r;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('OpenPerssua');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar/Ocultar', click: () => toggleOverlay(isDev) },
    { label: 'Mover para o próximo monitor', click: () => moveOverlayToNextDisplay() },
    { type: 'separator' },
    { label: 'Abrir pasta de logs', click: () => openLogsFolder() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
  tray.on('click', () => toggleOverlay(isDev));
}

async function bootstrap() {
  await app.whenReady();

  configurePermissions();

  db = new DatabaseManager(app.getPath('userData'));
  db.initialize();

  const settingsStore = new SettingsStore(app.getPath('userData'));

  // Ações dos atalhos globais. Em entrevista ou reunião o usuário não pode
  // ficar clicando no overlay: tudo funciona sem focar a janela.
  shortcuts = new ShortcutManager({
    settingsStore,
    handlers: {
      'toggle-overlay': () => toggleOverlay(isDev),
      'toggle-listen': () => sendToOverlay('overlay:toggle-listen'),
      assist: () => sendToOverlay('overlay:assist-trigger'),
      'copy-suggestion': () => sendToOverlay('overlay:copy-suggestion'),
      screenshot: () => sendToOverlay('overlay:screenshot-trigger'),
      // O texto é lido aqui no main: o renderer sem foco nem sempre consegue
      // ler a área de transferência.
      'clipboard-prompt': () => {
        const text = clipboard.readText().trim().slice(0, MAX_CLIPBOARD_CHARS);
        sendToOverlay('overlay:clipboard-prompt', { text });
      },
      'next-display': () => moveOverlayToNextDisplay(),
    },
  });

  createOverlayWindow({ isDev });
  registerIpc({ db, getOverlayWindow, isDev, settingsStore, shortcuts });
  createTray();
  await shortcuts.init();

  app.on('before-quit', () => {
    disposeIpc(); // encerra whisper-server e streams ativas
    if (db) db.close();
  });
}

app.on('will-quit', () => shortcuts?.dispose());

// App residente: fechar o overlay não encerra — sai pelo tray ou Cmd+Q.
app.on('window-all-closed', () => { /* intencionalmente vazio */ });

bootstrap().catch((err) => {
  log.error('bootstrap failed', err);
  app.quit();
});
