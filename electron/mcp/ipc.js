const crypto = require('node:crypto');
const { McpManager } = require('./Manager');
const { orchestrate, manual } = require('./orchestrator');

function registerMcpIpc({ ipcMain, safeStorage, settingsStore }) {
  const manager = new McpManager({ settingsStore, safeStorage });
  const confirmations = new Map();
  const handle = (channel, work) => ipcMain.handle(`mcp:${channel}`, work);
  handle('list', () => manager.list());
  handle('save', (_e, config) => manager.save(config));
  handle('import', (_e, json) => manager.import(json));
  handle('test', (_e, id) => manager.test(id));
  handle('enable', (_e, { id, enabled }) => manager.enable(id, enabled));
  handle('remove', (_e, id) => manager.remove(id));
  handle('mode', (_e, { id, name, mode }) => manager.setMode(id, name, mode));
  handle('confirm', (event, { id, allowed }) => {
    const pending = confirmations.get(id);
    if (pending?.sender === event.sender) pending.finish(allowed === true);
  });
  function confirm(sender, streamId, tool, args, signal) {
    if (signal.aborted || sender.isDestroyed()) return Promise.resolve(false);
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const finish = allowed => {
        if (!confirmations.delete(id)) return;
        clearTimeout(timer); signal.removeEventListener('abort', abort); sender.removeListener('destroyed', abort);
        if (!sender.isDestroyed()) sender.send('mcp:confirmation-closed', { id });
        resolve(allowed);
      };
      const abort = () => finish(false);
      const timer = setTimeout(abort, 45000);
      confirmations.set(id, { sender, finish });
      signal.addEventListener('abort', abort, { once: true }); sender.once('destroyed', abort);
      sender.send('mcp:confirmation', { id, streamId, server: tool.serverName, tool: tool.name, arguments: args });
    });
  }
  async function prepare(req, { chat, sender, streamId, signal }) {
    // Ignora contexto de ferramenta forjado e usa permissões salvas no main.
    const clean = { ...req, toolContext: undefined, mcpServerIds: [], mcpInstructions: {} };
    if (!manual(req)) return clean;
    const id = typeof req.assistantId === 'string' && /^[\w-]{1,80}$/.test(req.assistantId) ? req.assistantId : await settingsStore.get('assistants.active');
    const preferences = id ? await settingsStore.get(`assistant.preferences.${id}`) : null;
    clean.mcpServerIds = Array.isArray(preferences?.mcpServerIds) ? preferences.mcpServerIds.slice(0, 100) : [];
    clean.mcpInstructions = preferences?.mcpInstructions || {};
    const scoped = {
      available: (...args) => manager.available(...args),
      call: (tool, args, options) => manager.call(tool, args, { ...options, authorize: async () => {
        const latest = await settingsStore.get(`assistant.preferences.${id}`);
        return latest?.mcpServerIds?.includes(tool.serverId) === true;
      } }),
    };
    const result = await orchestrate({ req: clean, manager: scoped, chat, signal,
      confirm: (tool, args, active) => confirm(sender, streamId, tool, args, active),
      onUsed: used => { if (!sender.isDestroyed()) sender.send('mcp:used', { streamId, used }); } });
    return { ...clean, toolContext: result.context };
  }
  return {
    manager, prepare,
    dispose() { for (const pending of [...confirmations.values()]) pending.finish(false); manager.dispose(); },
  };
}
module.exports = { registerMcpIpc };
