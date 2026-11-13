// Atualização em segundo plano.
//
// A cada 1 h o app procura versão nova no GitHub e, se for atualização leve,
// já baixa sozinho (o pacote só é aceito com o hash da release). Depois:
//   - "instalação automática": reinicia sozinho na versão nova, mas nunca
//     durante a escuta. Espera a escuta parar há alguns minutos e a janela
//     estar sem uso, para não sumir com uma resposta que a pessoa está lendo.
//   - "instalação manual": só avisa que está pronta; a pessoa reinicia
//     quando quiser.
// Versão que precisa do instalador completo só é avisada, nos dois modos.

const { ipcMain } = require('electron');
const log = require('electron-log');
const updater = require('./updater');

const FIRST_CHECK_MS = 20 * 1000;          // espera o app assentar
const CHECK_EVERY_MS = 60 * 60 * 1000;     // procura de hora em hora
const IDLE_BEFORE_RESTART_MS = 3 * 60 * 1000; // sem escuta e sem uso há 3 min
const INSTALL_POLL_MS = 60 * 1000;

// Configuração antiga "update.autoCheck" = false vira instalação manual
async function readMode(settingsStore) {
  const mode = await settingsStore.get('update.mode');
  if (mode === 'auto' || mode === 'manual') return mode;
  return (await settingsStore.get('update.autoCheck')) === false ? 'manual' : 'auto';
}

function startAutoUpdate({ settingsStore, send, getOverlayWindow, run = true }) {
  let busy = false;              // escutando ou a IA respondendo (vem do renderer)
  let lastActivity = Date.now();
  let ready = null;              // { version } baixada e pronta para reiniciar
  let running = false;

  // O renderer avisa quando a escuta liga/desliga e quando a pessoa usa a janela
  ipcMain.handle('update:activity', (_e, state = {}) => {
    busy = Boolean(state.listening || state.working);
    lastActivity = Date.now();
    return { ok: true };
  });
  ipcMain.handle('update:get-mode', () => readMode(settingsStore));
  ipcMain.handle('update:set-mode', async (_e, mode) => {
    if (mode !== 'auto' && mode !== 'manual') return { ok: false, error: 'modo inválido' };
    await settingsStore.set('update.mode', mode);
    if (ready) send('update:ready', { ok: true, version: ready.version, current: updater.versionInfo().version, autoInstall: mode === 'auto' });
    maybeInstall();
    return { ok: true, mode };
  });

  async function cycle() {
    if (running) return;
    running = true;
    try {
      const r = await updater.checkForUpdate();
      if (!r.available) return;
      if (r.version === (await settingsStore.get('update.skipVersion'))) return;
      if (r.mode !== 'light' || !r.canInstall) {
        send('update:available', { ok: true, manual: false, ...r });
        return;
      }
      if (ready?.version !== r.version) {
        await updater.downloadUpdate();
        ready = { version: r.version };
        log.info('atualização baixada em segundo plano', r.version);
      }
      const mode = await readMode(settingsStore);
      send('update:ready', { ok: true, ...r, autoInstall: mode === 'auto' });
      await maybeInstall();
    } catch (err) {
      log.warn('atualização em segundo plano falhou', err);
    } finally {
      running = false;
    }
  }

  async function maybeInstall() {
    if (!ready || (await readMode(settingsStore)) !== 'auto') return;
    if (busy || Date.now() - lastActivity < IDLE_BEFORE_RESTART_MS) return;
    const win = getOverlayWindow();
    if (win && !win.isDestroyed() && win.isFocused()) return; // a pessoa está usando agora
    log.info('reiniciando sozinho na versão nova', ready.version);
    updater.installUpdate('light');
  }

  if (!run) return;
  setTimeout(cycle, FIRST_CHECK_MS);
  setInterval(cycle, CHECK_EVERY_MS);
  setInterval(maybeInstall, INSTALL_POLL_MS);
}

module.exports = { startAutoUpdate };
