// Registro central de handlers IPC — 1 domínio por bloco.
// Os nomes de canais seguem o padrão observado no original (domínio:ação).

const { ipcMain, app, clipboard, shell, safeStorage } = require('electron');
const { registerMcpIpc } = require('../mcp/ipc');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { reasoningOptions } = require('../llm/reasoning');
const { LLMRouter, TASKS } = require('../llm/LLMRouter');
const { WhisperService } = require('../stt/WhisperService');
const { isSecret, MASK } = require('../settings/SettingsStore');
const { TokenStore } = require('../llm/providers/ChatGPTOAuthAdapter');
const {
  setClickThrough, toggleOverlay, setCompactMode, repaintOverlay, persistWindowState,
} = require('../windows/OverlayWindow');
const { buildMessages } = require('../prompts');
const { buildPingMessages } = require('../prompts/followup');
const updater = require('../system/updater');
const { listDisplays, moveToDisplay } = require('../system/displays');
const { openLogsFolder, copyRecentLogs } = require('../system/logs');
const { captureScreen } = require('../system/screenshot');

// Qual configuração de "modelo por tarefa" vale para cada modo
const TASK_OF_MODE = {
  assist: 'assist', summary: 'summary', email: 'summary', compact: 'summary',
  screen: 'screen', translate: 'translate',
};
const taskFor = (req) => TASK_OF_MODE[req.mode] || 'chat';

// Streams LLM ativos, abortáveis pelo renderer (padrão `*:abort-stream`)
const activeStreams = new Map();

let whisper = null;
let mcp = null;

// Encerramento limpo: mata whisper-server e aborta streams (chamado no before-quit)
function disposeIpc() {
  for (const controller of activeStreams.values()) controller.abort();
  activeStreams.clear();
  if (whisper) whisper.dispose();
  mcp?.dispose();
}

function registerIpc({ db, getOverlayWindow, isDev, settingsStore, shortcuts }) {
  const userDataDir = app.getPath('userData');
  const tokenStore = new TokenStore(path.join(userDataDir, 'chatgpt-token.bin'), fs);
  const router = new LLMRouter({ settingsStore, tokenStore });
  mcp = registerMcpIpc({ ipcMain, safeStorage, settingsStore });

  const sendToOverlay = (channel, payload) => {
    const win = getOverlayWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  whisper = new WhisperService({ userDataDir, sendToRenderer: sendToOverlay });

  // ---- overlay ----
  ipcMain.on('overlay:toggle', () => toggleOverlay(isDev));
  ipcMain.handle('overlay:show', () => {
    const win = getOverlayWindow();
    if (win && !win.isDestroyed() && !win.isVisible()) win.showInactive();
  });
  ipcMain.handle('overlay:set-click-through', (_e, enabled) => setClickThrough(Boolean(enabled)));
  // Modo mini: reduz a janela para uma pílula; guarda o tamanho anterior p/ voltar
  let savedBounds = null;
  ipcMain.handle('overlay:set-compact', (_e, compact) => {
    const win = getOverlayWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'janela indisponível' };
    try {
      setCompactMode(compact);
      if (compact) {
        savedBounds = win.getBounds();
        // setBounds (x,y preservados) — mais confiável que setSize em janela
        // transparente/frameless no Windows
        win.setResizable(true);
        win.setBounds({ x: savedBounds.x, y: savedBounds.y, width: 420, height: 210 });
      } else {
        win.setBounds({
          x: savedBounds?.x ?? win.getBounds().x,
          y: savedBounds?.y ?? win.getBounds().y,
          width: savedBounds?.width || 420,
          height: savedBounds?.height || 640,
        });
        savedBounds = null;
      }
      repaintOverlay(win);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // ---- multi-monitor ----
  ipcMain.handle('overlay:list-displays', () => listDisplays(getOverlayWindow()));
  ipcMain.handle('overlay:move-to-display', (_e, displayId) => {
    const r = moveToDisplay(getOverlayWindow(), displayId);
    if (r.ok) { repaintOverlay(); persistWindowState(); }
    return r;
  });

  // ---- captura de tela e área de transferência ----
  ipcMain.handle('screen:capture', async () => {
    try {
      return { ok: true, ...(await captureScreen(getOverlayWindow())) };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  // Escrita pelo main: navigator.clipboard falha quando o overlay está sem
  // foco, que é justamente o caso dos atalhos globais.
  ipcMain.handle('clipboard:write-text', (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
  });

  // ---- logs ----
  ipcMain.handle('logs:open-folder', () => openLogsFolder());
  ipcMain.handle('logs:copy-recent', () => copyRecentLogs());

  // ---- atalhos configuráveis ----
  ipcMain.handle('shortcuts:list', () => shortcuts.list());
  ipcMain.handle('shortcuts:set', (_e, { id, accelerator }) => {
    // null = voltar ao padrão, "" = desativar, texto = combinação nova
    const value = accelerator === null || typeof accelerator === 'string' ? accelerator : null;
    return shortcuts.set(id, value);
  });
  ipcMain.handle('shortcuts:suspend', (_e, enabled) => shortcuts.suspend(enabled));

  // ---- modelos do Whisper ----
  ipcMain.handle('stt:list-models', () => whisper.listModels());
  ipcMain.handle('stt:download-model', async (_e, name) => {
    try {
      const r = await whisper.downloadModel(name, (p) => sendToOverlay('stt:model-progress', p));
      return { ok: true, cached: r.cached };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('stt:cancel-download', (_e, name) => whisper.cancelDownload(name));
  ipcMain.handle('stt:delete-model', (_e, name) => {
    try { return whisper.deleteModel(name); } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  // Diagnóstico: binário presente e modelo escolhido já baixado
  ipcMain.handle('stt:check', (_e, name) => {
    const { binary } = whisper.findBinary();
    let modelInstalled = false;
    try { modelInstalled = whisper.isInstalled(name); } catch { /* nome fora do catálogo */ }
    return { binary: Boolean(binary), modelInstalled };
  });

  // ---- STT ----
  ipcMain.handle('stt:start-session', (_e, opts) =>
    whisper.startSession({
      sessionId: opts.sessionId || crypto.randomUUID(),
      ...opts,
      // progresso de download do modelo → renderer (ex.: "baixando 42%")
      onProgress: (p) => sendToOverlay('stt:model-progress', p),
    }));
  ipcMain.handle('stt:stop-session', (_e, sessionId) => whisper.stopSession(sessionId));
  ipcMain.on('stt:send-audio', (_e, { sessionId, chunk }) => whisper.pushAudio(sessionId, chunk));
  ipcMain.handle('stt:flush', (_e, sessionId) => whisper.flush(sessionId));

  // ---- LLM ----
  ipcMain.handle('llm:list-providers', () => router.listProviders());
  ipcMain.handle('llm:list-tasks', () => TASKS);
  ipcMain.handle('llm:chat', async (event, req) => {
    const options = { model: req.model, task: taskFor(req), ...reasoningOptions(req, await settingsStore.get('llm.thinkMore')) };
    const controller = new AbortController(); const id = crypto.randomUUID(); activeStreams.set(id, controller);
    try {
      const prepared = await mcp.prepare(req, { sender: event.sender, signal: controller.signal,
        chat: (messages, signal) => router.chat({ ...options, messages, signal }) });
      if (controller.signal.aborted) throw new Error('cancelado');
      return await router.chat({ ...options, messages: buildMessages(prepared), signal: controller.signal });
    } finally { activeStreams.delete(id); }
  });
  // Diagnóstico: mede se o provedor principal responde e em quanto tempo
  ipcMain.handle('llm:test', async () => {
    const t0 = Date.now();
    try {
      const reply = await router.chat({ messages: buildPingMessages(), task: 'chat' });
      return { ok: true, ms: Date.now() - t0, reply: String(reply || '').slice(0, 80) };
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: String(err.message || err).slice(0, 300) };
    }
  });
  // Abre a página de criar API key de um provedor (só endereços conhecidos)
  ipcMain.handle('llm:open-key-page', async (_e, providerId) => {
    const p = (await router.listProviders()).find((x) => x.id === providerId);
    if (!p?.keyUrl || !p.keyUrl.startsWith('https://')) return { ok: false };
    await shell.openExternal(p.keyUrl);
    return { ok: true };
  });
  ipcMain.handle('llm:chat-stream', async (event, req) => {
    // O renderer pode escolher o id: assim ele filtra os chunks pelo id certo
    // desde o primeiro, sem misturar com outro stream que esteja rodando.
    const requested = typeof req.streamId === 'string' && /^[\w-]{8,64}$/.test(req.streamId)
      && !activeStreams.has(req.streamId);
    const streamId = requested ? req.streamId : crypto.randomUUID();
    const controller = new AbortController();
    activeStreams.set(streamId, controller);

    const send = (channel, payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };

    const options = { model: req.model, task: taskFor(req), ...reasoningOptions(req, await settingsStore.get('llm.thinkMore')) };
    mcp.prepare(req, { sender: event.sender, streamId, signal: controller.signal,
      chat: (messages, signal) => router.chat({ ...options, messages, signal }) })
      .then(prepared => {
        if (controller.signal.aborted) throw new Error('cancelado');
        return router.chatStream({ ...options, messages: buildMessages(prepared), signal: controller.signal,
          onChunk: delta => send('llm:stream-chunk', { streamId, delta }) });
      })
      .then(() => send('llm:stream-done', { streamId }))
      .catch((err) => send('llm:stream-error', { streamId, error: String(err.message || err) }))
      .finally(() => activeStreams.delete(streamId));

    return { streamId };
  });
  ipcMain.on('llm:abort-stream', (_e, streamId) => activeStreams.get(streamId)?.abort());

  // ---- Auth ChatGPT (OAuth PKCE) ----
  ipcMain.handle('auth:chatgpt:start', async () => {
    const adapter = router.providers.find((p) => p.id === 'chatgpt-oauth');
    return adapter.startLogin();
  });
  ipcMain.handle('auth:chatgpt:status', async () => {
    const adapter = router.providers.find((p) => p.id === 'chatgpt-oauth');
    // getValidToken já renova proativamente se estiver perto de expirar —
    // o status na UI nunca mostra "desconectado" por token expirado.
    const token = await adapter.getValidToken();
    return { authenticated: Boolean(token?.access_token) };
  });
  ipcMain.handle('auth:chatgpt:logout', () => tokenStore.clear());

  // ---- DB ----
  ipcMain.handle('db:create-session', (_e, meta) => db.createSession(meta));
  ipcMain.handle('db:add-message', (_e, msg) => { db.addMessage(msg); return { ok: true }; });
  ipcMain.handle('db:add-transcription', (_e, t) => { db.addTranscription(t); return { ok: true }; });
  ipcMain.handle('db:get-sessions-page', (_e, page = {}) =>
    db.getSessionsPage({
      offset: Math.max(0, Number(page.offset) || 0),
      limit: Math.min(100, Math.max(1, Number(page.limit) || 20)),
    }));
  ipcMain.handle('db:get-messages', (_e, id) => db.getMessages(id));
  ipcMain.handle('db:get-transcriptions', (_e, id) => db.getTranscriptions(id));
  ipcMain.handle('db:end-session', (_e, id) => { db.endSession(id); return { ok: true }; });
  ipcMain.handle('db:resume-session', (_e, id) => db.resumeSession(id));
  ipcMain.handle('db:update-subject', (_e, { id, subject }) => db.updateSubject(id, subject));
  ipcMain.handle('db:set-kind', (_e, { id, kind }) => db.setKind(id, kind));
  ipcMain.handle('db:delete-session', (_e, id) => db.deleteSession(id));
  ipcMain.handle('db:clear-all', () => db.clearAll());
  ipcMain.handle('db:get-stats', () => db.getStats());

  // ---- Settings ----
  // API keys nunca voltam para a tela: o renderer só sabe se existe uma
  ipcMain.handle('settings:get', (_e, key) => settingsStore.getForRenderer(key));
  ipcMain.handle('settings:set', (_e, { key, value }) => {
    if (typeof key !== 'string' || key.startsWith('mcp.')) throw new Error('Use a aba ferramentas para configurar MCP');
    if (isSecret(key) && value === MASK) return undefined; // campo não mexido
    return settingsStore.set(key, value);
  });
  ipcMain.handle('settings:delete', (_e, key) => {
    if (!/^assistant\.(context|preferences)\.[\w-]{1,80}$/.test(key)) throw new Error('chave inválida');
    return settingsStore.delete(key);
  });
  ipcMain.handle('settings:set-assistant-data', (_e, entries) => {
    if (!Array.isArray(entries) || entries.length > 301 || entries.some((entry) =>
      !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
      || !(entry[0] === 'assistants.custom' || /^assistant\.(context|preferences)\.[\w-]{1,80}$/.test(entry[0])))) {
      throw new Error('dados de assistentes inválidos');
    }
    return settingsStore.setMany(entries);
  });
  ipcMain.handle('settings:get-all', () => settingsStore.getAll());

  // ---- atualização ----
  ipcMain.handle('update:check', async () => {
    try { return { ok: true, ...(await updater.checkForUpdate()) }; } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('update:download', async () => {
    try {
      return await updater.downloadUpdate((p) => sendToOverlay('update:progress', p));
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('update:install', (_e, file) => updater.installUpdate(file));
  ipcMain.handle('update:open-page', (_e, url) => updater.openReleasesPage(url));
  ipcMain.handle('update:version', () => updater.versionInfo());
}

module.exports = { registerIpc, disposeIpc };
