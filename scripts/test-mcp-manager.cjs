const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { McpManager, parseImport } = require('../electron/mcp/Manager');
const { SettingsStore } = require('../electron/settings/SettingsStore');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teka-mcp-manager-'));
// Cifra falsa só para testar o contrato; a integração Electron testa safeStorage real.
const safe = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') };
(async () => {
  const store = new SettingsStore(temp);
  const manager = new McpManager({ settingsStore: store, safeStorage: safe });
  try {
    const [config] = parseImport(JSON.stringify({ mcpServers: { teste: { command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-server.cjs')], env: { TOKEN: 'segredo-unico' } } } }));
    await manager.save(config);
    const [server] = await manager.list();
    assert.equal(server.enabled, false); assert.equal(server.hasSecrets, true);
    assert(!JSON.stringify(server).includes('segredo-unico'));
    assert(!fs.readFileSync(store.filePath, 'utf8').includes('segredo-unico'));
    assert(!JSON.stringify(await store.getAll()).includes('mcp.servers'));
    await manager.enable(server.id, true); await manager.test(server.id);
    const tools = await manager.available([server.id]); assert.equal(tools.length, 2); assert.equal(tools[0].mode, 'confirm');
    await assert.rejects(manager.call(tools[0], { a: 1, b: 2 }, { confirm: async () => false }), /negado/);
    await manager.setMode(server.id, 'somar', 'off');
    await assert.rejects(manager.call(tools[0], { a: 1, b: 2 }, { confirm: async () => true }), /desligada/);
    await manager.setMode(server.id, 'somar', 'confirm');
    await assert.rejects(manager.call(tools[0], { a: 1, b: 2 }, { confirm: async () => { await manager.enable(server.id, false); return true; } }), /desligado|mudou/);
    const locked = new McpManager({ settingsStore: store, safeStorage: { isEncryptionAvailable: () => false } });
    await assert.rejects(locked.save({ name: 'x', type: 'http', url: 'https://example.com', headers: { Authorization: 'segredo' } }), /cifra/i);
    assert.throws(() => parseImport('{"mcpServers":{"x":{"url":"file:///a"}}}'), /URL/);
    assert.throws(() => parseImport('{"mcpServers":{"__proto__":{"command":"x"}}}'), /permitida/);
  } finally { manager.dispose(); fs.rmSync(temp, { recursive: true, force: true }); }
  console.log('PASS gerenciador MCP: cifra, importação, máscara, permissões e revalidação');
})().catch(e => { console.error(e); process.exitCode = 1; });
