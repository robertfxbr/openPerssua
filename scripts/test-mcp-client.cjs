const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { McpClient } = require('../electron/mcp/Client');
const fixture = path.join(__dirname, 'fixtures/mcp-server.cjs');
async function exercise(client) {
  try {
    await client.connect();
    assert.deepEqual((await client.listTools()).map(t => t.name), ['somar', 'buscar_nota']);
    assert.equal((await client.callTool('somar', { a: 2, b: 3 })).content[0].text, '5');
    assert.equal((await client.callTool('buscar_nota', { termo: 'erro' })).isError, true);
    await assert.rejects(client.callTool('buscar_nota', { termo: 'lento' }, { timeout: 60 }), /tempo/i);
    const controller = new AbortController();
    const pending = client.callTool('buscar_nota', { termo: 'lento' }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, /cancelad/i);
  } finally { client.close(); }
}
(async () => {
  const config = { type: 'stdio', command: process.execPath, args: [fixture] };
  const stalled = new McpClient({ ...config, args: [fixture, '--hang-initialize'] }, { connectTimeout: 100 });
  try { await assert.rejects(stalled.connect(), /tempo/i); } finally { stalled.close(); }
  const incompatible = new McpClient({ ...config, args: [fixture, '--invalid-version'] });
  try { await assert.rejects(incompatible.connect(), /versão/i); } finally { incompatible.close(); }
  await exercise(new McpClient(config));
  const childClient = new McpClient(config);
  try {
    await childClient.connect(); await childClient.callTool('buscar_nota', { termo: 'stderr' });
    assert(childClient.stderr.length <= 4000);
    await assert.rejects(childClient.callTool('buscar_nota', { termo: 'morrer' }), /encerrou/i);
    await childClient.connect();
    assert.equal((await childClient.callTool('somar', { a: 3, b: 4 })).content[0].text, '7');
  } finally { childClient.close(); }
  if (process.platform === 'win32') {
    const fs = require('node:fs'), os = require('node:os');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teka-mcp-'));
    const shim = path.join(temp, 'teste comando.cmd');
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
    try { await exercise(new McpClient({ type: 'stdio', command: shim, args: ['argumento com espaço'] })); }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
    // Shims com os nomes reais exercitam o mesmo caminho de npx/uvx sem rede.
    const shims = fs.mkdtempSync(path.join(os.tmpdir(), 'teka-mcp-shims-'));
    try {
      for (const command of ['npx', 'uvx']) {
        fs.writeFileSync(path.join(shims, `${command}.cmd`), `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
        await exercise(new McpClient({ type: 'stdio', command, args: ['argumento com espaço'], env: { Path: `${shims};${process.env.Path || process.env.PATH}` } }));
      }
    } finally { fs.rmSync(shims, { recursive: true, force: true }); }
  }
  const server = spawn(process.execPath, [fixture, '--http'], { env: { ...process.env, MCP_TEST_TOKEN: 'Bearer teste' }, windowsHide: true });
  server.stderr.resume();
  try {
    const port = await new Promise((resolve, reject) => { server.stdout.once('data', d => resolve(Number(String(d).trim()))); server.once('error', reject); });
    await exercise(new McpClient({ type: 'http', url: `http://127.0.0.1:${port}`, headers: { Authorization: 'Bearer teste' } }));
  } finally { server.kill(); }
  console.log('PASS cliente MCP: stdio, HTTP JSON/SSE, paginação, sessão, erro, timeout, cancelamento, reinício, stderr e comando Windows');
})().catch(e => { console.error(e); process.exitCode = 1; });
