// Teka — bootstrap do processo principal.
// Versão enxuta do main.js original (que tem ~1.450 linhas, 11 janelas,
// flavors whitelabel, telemetria e updater). Aqui: overlay + tray.

const fs = require('fs');
const path = require('path');
const { app, clipboard, session, ipcMain, Tray, Menu, nativeImage } = require('electron');
const log = require('electron-log');

// Captura de áudio do sistema (loopback: Discord/Zoom/Meet) — o plugin
// pede initMain() ANTES do app ficar pronto.
const { initMain: initAudioLoopback } = require('electron-audio-loopback');
initAudioLoopback();

const {
  createOverlayWindow, getOverlayWindow, toggleOverlay, repaintOverlay, persistWindowState,
  setGhost, getGhost,
} = require('./windows/OverlayWindow');
const { registerIpc, disposeIpc } = require('./ipc');
const { DatabaseManager } = require('./db/DatabaseManager');
const { SettingsStore } = require('./settings/SettingsStore');
const { ShortcutManager } = require('./shortcuts/ShortcutManager');
const { moveToNextDisplay } = require('./system/displays');
const { openLogsFolder } = require('./system/logs');
const updater = require('./system/updater');
const { confirmBoot } = require('./system/appBundle');

const UPDATE_FIRST_CHECK_MS = 20000;          // espera o app assentar
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // e repete a cada 6 h

const isDev = process.argv.includes('--dev');

// O app se chamava OpenPerssua. Quem já usava continua na pasta antiga:
// copiar para uma pasta nova perderia o login do ChatGPT e as API keys,
// porque o Windows cifra esses dados com uma chave guardada dentro da
// própria pasta. Instalação nova usa a pasta Teka. --user-data-dir manda.
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'openperssua');
if (!app.commandLine.hasSwitch('user-data-dir') && fs.existsSync(LEGACY_USER_DATA)) {
  app.setPath('userData', LEGACY_USER_DATA);
}
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

// Verificação de atualização. manual=true vem da bandeja: mostra o overlay e
// avisa até quando já está na última versão. A automática fica quieta, não
// abre a janela e respeita "ignorar esta versão".
async function checkUpdates(settingsStore, manual) {
  try {
    if (!manual && (await settingsStore.get('update.autoCheck')) === false) return;
    const r = await updater.checkForUpdate();
    if (!manual && (!r.available || r.version === (await settingsStore.get('update.skipVersion')))) return;
    const win = getOverlayWindow();
    if (!win || win.webContents.isDestroyed()) return;
    if (manual && !win.isVisible()) win.showInactive();
    win.webContents.send('update:available', { ok: true, manual, ...r });
  } catch (err) {
    log.warn('verificação de atualização falhou', err);
    if (manual) sendToOverlay('update:available', { ok: false, manual, error: String(err.message || err) });
  }
}

// Modo fantasma: muda a janela, guarda a escolha e acerta a bandeja.
// "Cliques atravessam" não é guardado: se o app abrisse assim, o usuário
// não conseguiria clicar nele.
async function changeGhost(settingsStore, patch) {
  const next = setGhost(patch);
  if (typeof patch.hidden === 'boolean') await settingsStore.set('ui.ghost', next.hidden);
  if (typeof patch.hideTray === 'boolean') await settingsStore.set('ui.ghostHideTray', patch.hideTray);
  await syncTray(settingsStore);
  const full = { ...next, hideTray: Boolean(await settingsStore.get('ui.ghostHideTray')) };
  // A UI acompanha também quando a mudança vem da bandeja ou do atalho
  const win = getOverlayWindow();
  if (win && !win.webContents.isDestroyed()) win.webContents.send('overlay:ghost-changed', full);
  return full;
}

// Com o fantasma ligado e "esconder da bandeja" marcado, o ícone some da
// área de notificação e o Teka volta pelos atalhos.
async function syncTray(settingsStore) {
  const hideTray = getGhost().hidden && Boolean(await settingsStore.get('ui.ghostHideTray'));
  if (hideTray) {
    if (tray) { tray.destroy(); tray = null; }
    return;
  }
  if (!tray) createTray(settingsStore);
  else tray.setContextMenu(trayMenu(settingsStore));
}

function trayMenu(settingsStore) {
  const g = getGhost();
  return Menu.buildFromTemplate([
    { label: 'Mostrar/Ocultar', click: () => toggleOverlay(isDev) },
    { label: 'Mover para o próximo monitor', click: () => moveOverlayToNextDisplay() },
    { type: 'separator' },
    { label: 'Modo fantasma (some do compartilhamento de tela)', type: 'checkbox', checked: g.hidden, click: () => changeGhost(settingsStore, { hidden: !g.hidden }) },
    { label: 'Cliques atravessam a janela', type: 'checkbox', checked: g.clickThrough, click: () => changeGhost(settingsStore, { clickThrough: !g.clickThrough }) },
    { type: 'separator' },
    { label: 'Verificar atualizações', click: () => checkUpdates(settingsStore, true) },
    { label: 'Abrir pasta de logs', click: () => openLogsFolder() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
}

function createTray(settingsStore) {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Teka');
  tray.setContextMenu(trayMenu(settingsStore));
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
      'toggle-ghost': () => changeGhost(settingsStore, { hidden: !getGhost().hidden }),
      'toggle-click-through': () => changeGhost(settingsStore, { clickThrough: !getGhost().clickThrough }),
    },
  });

  // O fantasma escolhido vale desde a primeira pintura da janela
  setGhost({ hidden: Boolean(await settingsStore.get('ui.ghost')) });
  ipcMain.handle('overlay:get-ghost', async () => ({
    ...getGhost(), hideTray: Boolean(await settingsStore.get('ui.ghostHideTray')),
  }));
  ipcMain.handle('overlay:set-ghost', (_e, patch = {}) => {
    const clean = {};
    for (const k of ['hidden', 'clickThrough', 'hideTray']) {
      if (typeof patch[k] === 'boolean') clean[k] = patch[k];
    }
    return changeGhost(settingsStore, clean);
  });

  createOverlayWindow({ isDev });
  // Atualização leve: a janela abriu, então o pacote está bom (ver bootstrap.js)
  if (global.tekaBundle) {
    getOverlayWindow()?.webContents.once('did-finish-load', () => confirmBoot(app.getPath('userData')));
  }
  registerIpc({ db, getOverlayWindow, isDev, settingsStore, shortcuts });
  await syncTray(settingsStore);
  await shortcuts.init();

  if (!isDev) {
    setTimeout(() => checkUpdates(settingsStore, false), UPDATE_FIRST_CHECK_MS);
    setInterval(() => checkUpdates(settingsStore, false), UPDATE_INTERVAL_MS);
  }

  app.on('before-quit', () => {
    disposeIpc(); // encerra whisper-server e streams ativas
    if (db) db.close();
  });
}

app.on('will-quit', () => { disposeIpc(); shortcuts?.dispose(); });

// App residente: fechar o overlay não encerra — sai pelo tray ou Cmd+Q.
app.on('window-all-closed', () => { /* intencionalmente vazio */ });

bootstrap().catch((err) => {
  log.error('bootstrap failed', err);
  app.quit();
});
