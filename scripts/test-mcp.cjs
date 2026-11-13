// Suíte MCP local; interface compilada é coberta em test:assistants.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const scripts = ['test-mcp-client.cjs', 'test-mcp-manager.cjs', 'test-mcp-orchestration.cjs', 'test-mcp-ipc.cjs', 'test-mcp-assistant.mjs'];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', windowsHide: true, timeout: 30000 });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS: ${scripts.length} scripts MCP sem modelos reais`);
