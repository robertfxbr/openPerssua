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

contextBridge.exposeInMainWorld('teka', {
  mcp: {
    list: () => invoke('mcp:list'),
    save: config => invoke('mcp:save', config),
    import: json => invoke('mcp:import', json),
    test: id => invoke('mcp:test', id),
    enable: (id, enabled) => invoke('mcp:enable', { id, enabled }),
    remove: id => invoke('mcp:remove', id),
    setMode: (id, name, mode) => invoke('mcp:mode', { id, name, mode }),
    confirm: (id, allowed) => invoke('mcp:confirm', { id, allowed }),
    onConfirmation: cb => on('mcp:confirmation', cb),
    onConfirmationClosed: cb => on('mcp:confirmation-closed', cb),
    onUsed: cb => on('mcp:used', cb),
  },
  overlay: {
    toggle: () => send('overlay:toggle'),
    show: () => invoke('overlay:show'),
    setClickThrough: (enabled) => invoke('overlay:set-click-through', enabled),
    getGhost: () => invoke('overlay:get-ghost'),
    setGhost: (patch) => invoke('overlay:set-ghost', patch),
    onGhostChanged: (cb) => on('overlay:ghost-changed', cb),
    setCompact: (compact) => invoke('overlay:set-compact', compact),
    onAssistTrigger: (cb) => on('overlay:assist-trigger', cb),
    onCopySuggestion: (cb) => on('overlay:copy-suggestion', cb),
    onToggleListen: (cb) => on('overlay:toggle-listen', cb),
    onScreenshotTrigger: (cb) => on('overlay:screenshot-trigger', cb),
    onClipboardPrompt: (cb) => on('overlay:clipboard-prompt', cb),
    listDisplays: () => invoke('overlay:list-displays'),
    moveToDisplay: (displayId) => invoke('overlay:move-to-display', displayId),
  },
  screen: {
    capture: () => invoke('screen:capture'),
  },
  clipboard: {
    readText: () => invoke('clipboard:read-text'),
    writeText: (text) => invoke('clipboard:write-text', text),
  },
  logs: {
    openFolder: () => invoke('logs:open-folder'),
    copyRecent: () => invoke('logs:copy-recent'),
  },
  shortcuts: {
    list: () => invoke('shortcuts:list'),
    set: (id, accelerator) => invoke('shortcuts:set', { id, accelerator }),
    suspend: (enabled) => invoke('shortcuts:suspend', enabled),
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
    listModels: () => invoke('stt:list-models'),
    downloadModel: (name) => invoke('stt:download-model', name),
    cancelDownload: (name) => invoke('stt:cancel-download', name),
    deleteModel: (name) => invoke('stt:delete-model', name),
    check: (name) => invoke('stt:check', name),
  },
  update: {
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: (file) => invoke('update:install', file),
    openPage: (url) => invoke('update:open-page', url),
    version: () => invoke('update:version'),
    onAvailable: (cb) => on('update:available', cb),
    onProgress: (cb) => on('update:progress', cb),
  },
  llm: {
    listProviders: () => invoke('llm:list-providers'),
    listTasks: () => invoke('llm:list-tasks'),
    test: () => invoke('llm:test'),
    openKeyPage: (providerId) => invoke('llm:open-key-page', providerId),
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
    endSession: (sessionId) => invoke('db:end-session', sessionId),
    resumeSession: (sessionId) => invoke('db:resume-session', sessionId),
    updateSubject: (sessionId, subject) => invoke('db:update-subject', { id: sessionId, subject }),
    setKind: (sessionId, kind) => invoke('db:set-kind', { id: sessionId, kind }),
    deleteSession: (sessionId) => invoke('db:delete-session', sessionId),
    clearAll: () => invoke('db:clear-all'),
    getStats: () => invoke('db:get-stats'),
  },
  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', { key, value }),
    getAll: () => invoke('settings:get-all'),
    delete: (key) => invoke('settings:delete', key),
    setAssistantData: (entries) => invoke('settings:set-assistant-data', entries),
  },
});
