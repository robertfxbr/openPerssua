// Registro central de handlers IPC — 1 domínio por bloco.
// Os nomes de canais seguem o padrão observado no original (domínio:ação).

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { LLMRouter } = require('../llm/LLMRouter');
const { WhisperService } = require('../stt/WhisperService');
const { SettingsStore } = require('../settings/SettingsStore');
const { TokenStore } = require('../llm/providers/ChatGPTOAuthAdapter');
const { setClickThrough, toggleOverlay, setCompactMode } = require('../windows/OverlayWindow');
const { buildCopilotMessages, buildSummaryMessages } = require('../prompts/meeting');
const { buildAssistMessages } = require('../prompts/assist');

function buildMessages(req) {
  if (req.mode === 'summary') return buildSummaryMessages({ transcript: req.transcript });
  if (req.mode === 'assist') {
    return buildAssistMessages({
      transcript: req.transcript,
      question: req.question,
      mode: req.assistMode,
      profile: req.profile,
      instruction: req.instruction,
    });
  }
  return buildCopilotMessages(req);
}

// Streams LLM ativos, abortáveis pelo renderer (padrão `*:abort-stream`)
const activeStreams = new Map();

let whisper = null;

// Encerramento limpo: mata whisper-server e aborta streams (chamado no before-quit)
function disposeIpc() {
  for (const controller of activeStreams.values()) controller.abort();
  activeStreams.clear();
  if (whisper) whisper.dispose();
}

function registerIpc({ db, getOverlayWindow, isDev }) {
  const userDataDir = app.getPath('userData');
  const settingsStore = new SettingsStore(userDataDir);
  const tokenStore = new TokenStore(path.join(userDataDir, 'chatgpt-token.bin'), fs);
  const router = new LLMRouter({ settingsStore, tokenStore });

  const sendToOverlay = (channel, payload) => {
    const win = getOverlayWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  whisper = new WhisperService({ userDataDir, sendToRenderer: sendToOverlay });

  // ---- overlay ----
  ipcMain.on('overlay:toggle', () => toggleOverlay(isDev));
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
        win.setBounds({ x: savedBounds.x, y: savedBounds.y, width: 400, height: 148 });
      } else {
        win.setBounds({
          x: savedBounds?.x ?? win.getBounds().x,
          y: savedBounds?.y ?? win.getBounds().y,
          width: savedBounds?.width || 420,
          height: savedBounds?.height || 640,
        });
        savedBounds = null;
      }
      // Bug conhecido do Electron no Windows: janela transparente não repinta
      // após resize programático — invalidate força a repintura, e o ciclo
      // opacity 0.99→1 derruba o cache de superfície do DWM se persistir.
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.webContents.invalidate();
        win.setOpacity(0.99);
        setTimeout(() => { if (!win.isDestroyed()) win.setOpacity(1); }, 40);
      }, 80);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
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
  ipcMain.handle('llm:chat', async (_e, req) => {
    return router.chat({ messages: buildMessages(req), model: req.model });
  });
  ipcMain.handle('llm:chat-stream', async (event, req) => {
    const streamId = crypto.randomUUID();
    const controller = new AbortController();
    activeStreams.set(streamId, controller);

    const send = (channel, payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };

    router.chatStream({
      messages: buildMessages(req),
      model: req.model,
      signal: controller.signal,
      onChunk: (delta) => send('llm:stream-chunk', { streamId, delta }),
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

  // ---- Settings ----
  ipcMain.handle('settings:get', (_e, key) => settingsStore.get(key));
  ipcMain.handle('settings:set', (_e, { key, value }) => settingsStore.set(key, value));
  ipcMain.handle('settings:get-all', () => settingsStore.getAll());
}

module.exports = { registerIpc, disposeIpc };
