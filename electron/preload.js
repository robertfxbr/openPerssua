// contextBridge único com allowlist explícita.
// O original expõe 282 membros via 4 bridges; aqui um bridge só, enxuto.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

// Assinatura de eventos com unsubscribe (stream de transcrição/LLM)
function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('openperssua', {
  overlay: {
    toggle: () => send('overlay:toggle'),
    setClickThrough: (enabled) => invoke('overlay:set-click-through', enabled),
    setCompact: (compact) => invoke('overlay:set-compact', compact),
    onAssistTrigger: (cb) => on('overlay:assist-trigger', cb),
    onCopySuggestion: (cb) => on('overlay:copy-suggestion', cb),
    onToggleListen: (cb) => on('overlay:toggle-listen', cb),
  },
  audio: {
    // electron-audio-loopback: habilita/desabilita o override do getDisplayMedia
    enableLoopback: () => invoke('enable-loopback-audio'),
    disableLoopback: () => invoke('disable-loopback-audio'),
  },
  stt: {
    startSession: (opts) => invoke('stt:start-session', opts),
    stopSession: (sessionId) => invoke('stt:stop-session', sessionId),
    sendAudio: (sessionId, chunk) => send('stt:send-audio', { sessionId, chunk }),
    flush: (sessionId) => invoke('stt:flush', sessionId),
    onDelta: (cb) => on('stt:transcription-delta', cb),
    onComplete: (cb) => on('stt:transcription-complete', cb),
    onModelProgress: (cb) => on('stt:model-progress', cb),
  },
  llm: {
    listProviders: () => invoke('llm:list-providers'),
    chat: (req) => invoke('llm:chat', req),
    chatStream: (req) => invoke('llm:chat-stream', req),
    abortStream: (streamId) => send('llm:abort-stream', streamId),
    onStreamChunk: (cb) => on('llm:stream-chunk', cb),
    onStreamDone: (cb) => on('llm:stream-done', cb),
    onStreamError: (cb) => on('llm:stream-error', cb),
  },
  auth: {
    startChatGptOAuth: () => invoke('auth:chatgpt:start'),
    getChatGptStatus: () => invoke('auth:chatgpt:status'),
    logoutChatGpt: () => invoke('auth:chatgpt:logout'),
  },
  db: {
    createSession: (meta) => invoke('db:create-session', meta),
    addMessage: (msg) => invoke('db:add-message', msg),
    addTranscription: (t) => invoke('db:add-transcription', t),
    getSessions: (page) => invoke('db:get-sessions-page', page),
    getMessages: (sessionId) => invoke('db:get-messages', sessionId),
    getTranscriptions: (sessionId) => invoke('db:get-transcriptions', sessionId),
  },
  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', { key, value }),
    getAll: () => invoke('settings:get-all'),
  },
});
