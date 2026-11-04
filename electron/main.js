// OpenPerssua — bootstrap do processo principal.
// Versão enxuta do main.js original (que tem ~1.450 linhas, 11 janelas,
// flavors whitelabel, telemetria e updater). Aqui: overlay + tray.

const path = require('path');
const { app, globalShortcut, session, Tray, Menu, nativeImage } = require('electron');
const log = require('electron-log');

// Captura de áudio do sistema (loopback: Discord/Zoom/Meet) — o plugin
// pede initMain() ANTES do app ficar pronto.
const { initMain: initAudioLoopback } = require('electron-audio-loopback');
initAudioLoopback();

const { createOverlayWindow, getOverlayWindow, toggleOverlay } = require('./windows/OverlayWindow');
const { registerIpc, disposeIpc } = require('./ipc');
const { DatabaseManager } = require('./db/DatabaseManager');

const isDev = process.argv.includes('--dev');
log.initialize();

let db = null;
let tray = null;

// Sem este handler, o Electron NEGA getUserMedia por padrão em apps empacotados
// e o microfone falha silenciosamente no renderer.
function configurePermissions() {
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('OpenPerssua');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar/Ocultar (Ctrl+Shift+Space)', click: () => toggleOverlay(isDev) },
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

  createOverlayWindow({ isDev });
  registerIpc({ db, getOverlayWindow, isDev });
  createTray();

  const ok = globalShortcut.register('CommandOrControl+Shift+Space', () => toggleOverlay(isDev));
  if (!ok) log.warn('atalho global Ctrl+Shift+Space não registrado (em uso por outro app?)');

  // Atalhos de ação — em entrevista real o usuário não pode ficar clicando
  // no overlay: ✦ sugerir agora / copiar última sugestão sem focar a janela.
  const sendToOverlay = (channel) => {
    const win = getOverlayWindow();
    if (win && !win.webContents.isDestroyed()) {
      if (!win.isVisible()) win.show();
      win.webContents.send(channel);
    }
  };
  if (!globalShortcut.register('CommandOrControl+Shift+Enter', () => sendToOverlay('overlay:assist-trigger'))) {
    log.warn('atalho Ctrl+Shift+Enter não registrado');
  }
  // Liga/desliga a escuta sem focar a janela
  if (!globalShortcut.register('CommandOrControl+Shift+M', () => sendToOverlay('overlay:toggle-listen'))) {
    log.warn('atalho Ctrl+Shift+M não registrado');
  }
  // Ctrl+Shift+C costuma estar em uso (terminal, outros copilotos) — tenta fallback
  if (!globalShortcut.register('CommandOrControl+Shift+C', () => sendToOverlay('overlay:copy-suggestion'))
    && !globalShortcut.register('CommandOrControl+Shift+Y', () => sendToOverlay('overlay:copy-suggestion'))) {
    log.warn('atalhos de copiar sugestão não registrados (C e Y ocupados)');
  }

  app.on('before-quit', () => {
    disposeIpc(); // encerra whisper-server e streams ativas
    if (db) db.close();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());

// App residente: fechar o overlay não encerra — sai pelo tray ou Cmd+Q.
app.on('window-all-closed', () => { /* intencionalmente vazio */ });

bootstrap().catch((err) => {
  log.error('bootstrap failed', err);
  app.quit();
});
