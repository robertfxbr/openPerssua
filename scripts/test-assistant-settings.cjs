const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore } = require('../electron/settings/SettingsStore');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teka-settings-test-'));
  const store = new SettingsStore(dir);
  const original = [{ id: 'c-antigo' }];
  await store.set('assistants.custom', original);
  await store.setMany([['assistants.custom', [...original, { id: 'c-novo' }]], ['assistant.context.c-novo', { text: 'teste', files: [] }]]);
  const reopened = new SettingsStore(dir);
  assert.equal((await reopened.get('assistants.custom')).length, 2);
  assert.equal((await reopened.get('assistant.context.c-novo')).text, 'teste');
  const savedPath = store.filePath;
  store.filePath = path.join(dir, 'ausente', 'settings.json');
  await assert.rejects(store.setMany([['assistants.custom', []]]));
  assert.equal((await store.get('assistants.custom')).length, 2);
  store.filePath = savedPath;
  await store.delete('assistant.context.c-novo');
  assert.equal(await new SettingsStore(dir).get('assistant.context.c-novo'), undefined);
  console.log('PASS: importação gravada em conjunto, falha sem alterar cache e exclusão persistida');
})().catch((e) => { console.error(e); process.exitCode = 1; });
