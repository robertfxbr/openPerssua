const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerMcpIpc } = require('../electron/mcp/ipc');
const handlers = new Map();
const data = { 'assistants.active': 'a', 'assistant.preferences.a': { mcpServerIds: ['s'] } };
const store = { get: async key => data[key], set: async (key, value) => { data[key] = value; } };
const service = registerMcpIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, settingsStore: store });
const sender = new EventEmitter(); sender.isDestroyed = () => false;
let sent = [], calls = 0;
sender.send = (channel, payload) => { sent.push({ channel, payload }); sender.emit(channel, payload); };
const tool = { id: 's:somar', serverId: 's', serverName: 'Teste', name: 'somar', inputSchema: { type: 'object' } };
service.manager.available = async () => [tool];
service.manager.call = async (t, args, { confirm, signal, authorize }) => {
  if (!(await confirm(t, args, signal))) throw new Error('Uso negado');
  if (!(await authorize())) throw new Error('Não autorizado');
  calls++; return { content: [{ type: 'text', text: '5' }] };
};
const chat = async messages => messages[0].content.includes('Resuma o resultado bruto') ? '{"context":"5"}'
  : messages[0].content.includes('Decida se os resultados') ? '{"action":"answer"}' : '{"action":"call","tool":"s:somar","arguments":{}}';
async function prepare() {
  const controller = new AbortController();
  const result = service.prepare({ question: 'soma?', assistantId: 'a', toolContext: 'FORJADO', mcpServerIds: ['intruso'] }, { chat, sender, streamId: 'stream-teste', signal: controller.signal });
  while (!sent.some(m => m.channel === 'mcp:confirmation')) await new Promise(r => setTimeout(r, 1));
  const { id } = sent.find(m => m.channel === 'mcp:confirmation').payload;
  return { result, controller, id };
}
(async () => {
  try {
    let p = await prepare();
    await handlers.get('mcp:confirm')({ sender: {} }, { id: p.id, allowed: true });
    assert.equal(calls, 0);
    await handlers.get('mcp:confirm')({ sender }, { id: p.id, allowed: false });
    assert(!(await p.result).toolContext.includes('FORJADO')); assert.equal(calls, 0);
    sent = []; p = await prepare(); p.controller.abort(); await p.result; assert.equal(calls, 0);
    assert(sent.some(m => m.channel === 'mcp:confirmation-closed'));
    sent = []; p = await prepare();
    await handlers.get('mcp:confirm')({ sender }, { id: p.id, allowed: true });
    assert((await p.result).toolContext.includes('5')); assert.equal(calls, 1);
    sent = []; p = await prepare(); delete data['assistant.preferences.a'];
    await handlers.get('mcp:confirm')({ sender }, { id: p.id, allowed: true });
    await p.result; assert.equal(calls, 1);
    console.log('PASS IPC MCP: permissões do main, isolamento do remetente, negar, cancelar, permitir e revogar');
  } finally { service.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
