// Suíte local dos assistentes, incluindo interface com provedor simulado.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const scripts = ['test-assistant-prompts.cjs', 'test-assistant-context.mjs', 'test-assistant-model.mjs',
  'test-assistant-transfer.mjs', 'test-assistant-settings.cjs', 'test-reasoning.cjs',
  'test-listen-reminder.mjs', 'test-assistants-ui.cjs'];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS: ${scripts.length} scripts de teste, sem chamadas a modelos reais`);
