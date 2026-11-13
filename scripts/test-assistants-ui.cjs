// Interface compilada + preload real, com settings temporários e LLM simulado.
// Não abre a instância do usuário nem faz chamadas a modelos.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true, timeout: 90000 });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pdfBytes } = require('./fixtures/pdf.cjs');
const { SettingsStore } = require('../electron/settings/SettingsStore');
const { buildMessages } = require('../electron/prompts');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teka-assistants-ui-'));
app.setPath('userData', temp);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const settings = new SettingsStore(temp);
const requests = [];
const errors = [];
const consoleMessages = [];
let win;
let delayedSettings = false;
let createdSessions = 0;
let resumedSessions = 0;
let stoppedStt = 0;
const savedTranscriptions = [];

const timer = setTimeout(() => { console.error('Tempo limite do teste de interface'); app.exit(1); }, 80000);
async function waitFor(predicate, message) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Tempo limite: ${message}`);
}
const js = (code) => win.webContents.executeJavaScript(code, true).catch((e) => { throw new Error(`${code.slice(0, 180)}: ${e.message}`); });
const click = async (text) => {
  await waitFor(() => js(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`), `botão ${text}`);
  return js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('Botão ausente: ' + ${JSON.stringify(text)}); b.click(); })()`);
};
const clickSelector = async (selector) => {
  await waitFor(() => js(`document.querySelector(${JSON.stringify(selector)}) !== null`), `botão ${selector}`);
  return js(`document.querySelector(${JSON.stringify(selector)}).click()`);
};
const setValue = async (selector, value) => {
  await waitFor(() => js(`document.querySelector(${JSON.stringify(selector)}) !== null`), `campo ${selector}`);
  return js(`(() => {
  const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Campo ausente');
  Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)});
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
})()`);
};
const attach = async (selector, name, content, type = 'text/plain') => {
  await waitFor(() => js(`document.querySelector(${JSON.stringify(selector)}) !== null`), `anexo ${selector}`);
  return js(`(() => {
  const e = document.querySelector(${JSON.stringify(selector)}); const dt = new DataTransfer();
  dt.items.add(new File([${Array.isArray(content) ? `new Uint8Array(${JSON.stringify(content)})` : JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
  e.files = dt.files; e.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
};

app.whenReady().then(async () => {
  console.log('UI: preparando ambiente temporário');
  await settings.set('onboarding.done', '1');
  await settings.set('llm.provider', 'ollama');
  await settings.set('assist.profile', 'Perfil global fictício');
  await settings.set('assistants.custom', [{ id: 'c-antigo', name: 'Legado', mode: 'interview', instructions: 'GERAL_LEGADO' }]);
  await settings.set('assistants.active', 'c-antigo');
  await settings.set('assist.auto', false);
  ipcMain.handle('settings:get', (_e, key) => settings.get(key));
  ipcMain.handle('settings:get-all', () => settings.getAll());
  ipcMain.handle('settings:set', async (_e, { key, value }) => {
    if (delayedSettings && key === 'assistants.custom') await new Promise((resolve) => setTimeout(resolve, 100));
    return settings.set(key, value);
  });
  ipcMain.handle('settings:set-assistant-data', (_e, entries) => settings.setMany(entries));
  ipcMain.handle('settings:delete', (_e, key) => settings.delete(key));
  ipcMain.handle('shortcuts:list', () => []);
  ipcMain.handle('llm:list-providers', () => [{ id: 'ollama', label: 'Simulado', configured: true, fields: [] }]);
  ipcMain.handle('llm:list-tasks', () => ({ chat: 'perguntas', assist: 'ao vivo' }));
  ipcMain.handle('stt:list-models', () => []);
  ipcMain.handle('stt:start-session', () => ({ sessionId: `stt-${crypto.randomUUID()}` }));
  ipcMain.handle('stt:stop-session', () => { stoppedStt++; return { ok: true }; });
  ipcMain.handle('stt:flush', () => ({ ok: true }));
  ipcMain.handle('db:create-session', () => { createdSessions++; return { id: 'sessao-ficticia' }; });
  ipcMain.handle('db:resume-session', () => { resumedSessions++; return { ok: true }; });
  ipcMain.handle('db:add-transcription', (_e, t) => { savedTranscriptions.push(t); return { ok: true }; });
  ipcMain.handle('db:end-session', () => ({ ok: true }));
  ipcMain.handle('db:add-message', () => ({ ok: true }));
  ipcMain.handle('enable-loopback-audio', () => ({ ok: true }));
  ipcMain.handle('disable-loopback-audio', () => ({ ok: true }));
  ipcMain.handle('overlay:set-compact', () => ({ ok: true }));
  ipcMain.handle('overlay:show', () => undefined);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
  ipcMain.handle('llm:chat-stream', (event, req) => {
    const messages = buildMessages(req); requests.push({ ...req, messages });
    setTimeout(() => {
      event.sender.send('llm:stream-chunk', { streamId: req.streamId, delta: 'Resposta fictícia para o teste.' });
      event.sender.send('llm:stream-done', { streamId: req.streamId });
    }, 50);
    return { streamId: req.streamId };
  });
  ipcMain.handle('llm:chat', (_event, req) => { requests.push({ ...req, messages: buildMessages(req) }); return '["Como confirmar isso?","Qual o próximo passo?"]'; });
  win = new BrowserWindow({ width: 420, height: 700, show: false, webPreferences: {
    preload: path.resolve(__dirname, '../electron/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true,
  } });
  win.webContents.on('console-message', (event) => { consoleMessages.push(event.message); if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('render-process-gone', (_event, detail) => errors.push(detail.reason));
  console.log('UI: carregando renderer');
  await win.loadFile(path.resolve(__dirname, '../dist/index.html'));
  await waitFor(() => js(`document.querySelector('.profile-row select')?.value === 'c-antigo'`), 'carregar legado');
  await clickSelector('[title="Configurações"]');
  await click('assistentes');
  await waitFor(() => js(`document.querySelectorAll('.assistant-row').length === 8`), 'lista');
  assert.equal(await js(`document.querySelector('.assistant-row.active .assistant-name').textContent.includes('Legado')`), true);

  console.log('UI: editando legado');
  // Edita um assistente antigo; os campos avançados começam fechados.
  await clickSelector('.assistant-row.active [title="Editar"]');
  assert.equal(await js(`document.querySelector('.assistant-uses').open`), false);
  assert.equal(await js(`document.querySelector('[aria-label="Instruções gerais"]').value`), 'GERAL_LEGADO');
  await setValue('[placeholder="nome do assistente"]', 'Legado editado');
  await setValue('[list="assistant-categories"]', 'Teste próprio');
  await js(`document.querySelector('.assistant-uses').open = true`);
  await setValue('.assistant-uses textarea', 'RESPOSTA_LEGADO');
  await click('salvar');
  await waitFor(async () => (await settings.get('assistants.custom'))[0].name === 'Legado editado', 'salvar legado');
  assert.equal((await settings.get('assistants.custom'))[0].instructions, 'GERAL_LEGADO');
  assert.equal((await settings.get('assistants.custom'))[0].instructionsByUse.response, 'RESPOSTA_LEGADO');

  console.log('UI: contexto em pronto');
  // Contexto em pronto, anexos e preferência sem tornar o preset editável.
  await clickSelector('[title="Contexto de Padrão"]');
  await setValue('.assistant-context textarea', 'Dados fictícios do assistente pronto');
  await attach('.assistant-context input[type=file]', 'teste.txt', 'Texto anexado fictício');
  await waitFor(async () => (await settings.get('assistant.context.padrao'))?.files.length === 1, 'anexar texto');
  await clickSelector('.assistant-context input[type=checkbox]');
  await waitFor(async () => (await settings.get('assistant.preferences.padrao'))?.certainOnly, 'salvar certeza');
  assert.equal(await js(`document.querySelector('.assistant-row').querySelector('[title="Editar"]') === null`), true);

  console.log('UI: extraindo PDF em worker');
  await js(`window.__workers = []; const RealWorker = window.Worker; window.Worker = class extends RealWorker { constructor(...args) { super(...args); window.__workers.push(String(args[0])); } }; true;`);
  await attach('.assistant-context input[type=file]', 'curriculo.pdf', Array.from(pdfBytes('Curriculo ficticio')), 'application/pdf');
  await waitFor(async () => (await settings.get('assistant.context.padrao'))?.files.length === 2, 'extrair PDF na interface');
  assert.match((await settings.get('assistant.context.padrao')).files[1].text, /Curriculo ficticio/);
  assert.equal(await js(`window.__workers.length > 0`), true);
  assert.equal(consoleMessages.some((message) => message.includes('fake worker')), false);
  await attach('.assistant-context input[type=file]', 'escaneado.pdf', Array.from(pdfBytes('')), 'application/pdf');
  await waitFor(() => js(`document.querySelector('.assistant-context').textContent.includes('não tem texto para extrair')`), 'aviso de PDF sem texto');
  assert.equal((await settings.get('assistant.context.padrao')).files.length, 2);
  await attach('.assistant-context input[type=file]', 'longo.txt', 'a'.repeat(21000));
  await waitFor(() => js(`document.querySelector('.assistant-context').textContent.includes('texto cortado')`), 'corte de texto');
  await clickSelector('[title="Remover longo.txt"]');
  await waitFor(async () => (await settings.get('assistant.context.padrao'))?.files.length === 2, 'remover anexo');

  // Busca, categoria e contexto no assistente próprio.
  await setValue('[aria-label="Buscar assistente pelo nome"]', 'legado');
  assert.equal(await js(`document.querySelectorAll('.assistant-row').length`), 1);
  await setValue('[aria-label="Filtrar categoria"]', 'Teste próprio');
  await clickSelector('[title="Contexto de Legado editado"]');
  await setValue('.assistant-context textarea', 'Contexto legado fictício');
  await clickSelector('.assistant-context input[type=checkbox]');
  await waitFor(async () => (await settings.get('assistant.context.c-antigo'))?.text === 'Contexto legado fictício', 'contexto legado');

  console.log('UI: exportando e importando');
  // Exporta de verdade para a pasta temporária; importa com conflito.
  const downloadPath = path.join(temp, 'assistentes.json');
  let downloaded = false;
  session.defaultSession.once('will-download', (_event, item) => {
    item.setSavePath(downloadPath);
    item.once('done', (_event, state) => { downloaded = state === 'completed'; });
  });
  await click('exportar JSON');
  await waitFor(() => downloaded, 'exportar JSON');
  const exported = fs.readFileSync(downloadPath, 'utf8');
  assert.equal(JSON.parse(exported).assistants.length, 1);
  await attach('input[accept=".json,application/json"]', 'assistentes.json', exported, 'application/json');
  await waitFor(async () => (await settings.get('assistants.custom')).length === 2, 'importar conflito');
  const imported = (await settings.get('assistants.custom'))[1];
  assert.notEqual(imported.id, 'c-antigo');
  assert.equal((await settings.get(`assistant.context.${imported.id}`)).text, 'Contexto legado fictício');
  assert.equal((await settings.get(`assistant.preferences.${imported.id}`)).certainOnly, true);
  await js(`document.querySelectorAll('.assistant-row [title="Excluir"]')[1].click()`);
  await waitFor(async () => (await settings.get('assistants.custom')).length === 1 && (await settings.get(`assistant.context.${imported.id}`)) === undefined, 'excluir contexto');

  // Duas exclusões no mesmo instante não podem restaurar um item apagado.
  const twice = JSON.parse(exported);
  twice.assistants = [0, 1].map((i) => ({ ...twice.assistants[0], id: `c-apagar-${i}`, name: `Apagar ${i}` }));
  await attach('input[accept=".json,application/json"]', 'duas.json', JSON.stringify(twice), 'application/json');
  await waitFor(async () => (await settings.get('assistants.custom')).length === 3, 'importar dois');
  await waitFor(() => js(`document.querySelectorAll('.assistant-row [title="Excluir"]').length === 3`), 'exibir dois');
  delayedSettings = true;
  await js(`(() => { const buttons = [...document.querySelectorAll('.assistant-row [title="Excluir"]')]; buttons[1].click(); buttons[2].click(); })()`);
  await waitFor(async () => !(await settings.get('assistants.custom')).some((a) => a.id === 'c-apagar-0'), 'excluir sem corrida');
  assert.equal((await settings.get('assistants.custom')).some((a) => a.id === 'c-apagar-1'), true);
  await waitFor(() => js(`document.querySelectorAll('.assistant-row [title="Excluir"]').length === 2`), 'terminar exclusão');
  delayedSettings = false;

  // Extração que termina após a exclusão não pode recriar o contexto.
  await clickSelector('[title="Contexto de Apagar 1"]');
  await js(`window.__textOriginal = File.prototype.text; File.prototype.text = function() { return this.name === 'pendente.txt' ? new Promise(resolve => { window.__finishFile = () => resolve('NAO_RECRIAR_CONTEXTO'); }) : window.__textOriginal.call(this); }; true;`);
  await attach('.assistant-context input[type=file]', 'pendente.txt', 'aguardando');
  await waitFor(() => js(`typeof window.__finishFile === 'function'`), 'extração pendente');
  await js(`document.querySelectorAll('.assistant-row [title="Excluir"]')[1].click()`);
  await waitFor(async () => (await settings.get('assistant.context.c-apagar-1')) === undefined, 'apagar contexto pendente');
  await js(`window.__finishFile(); File.prototype.text = window.__textOriginal; true;`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await settings.get('assistant.context.c-apagar-1'), undefined);

  // Trocar de aba durante a leitura cancela o callback antigo de importação.
  const delayedImport = JSON.parse(exported);
  delayedImport.assistants[0].id = 'c-espera';
  await js(`File.prototype.text = function() { return this.name === 'demorado.json' ? new Promise(resolve => { window.__finishImport = () => resolve(${JSON.stringify(JSON.stringify(delayedImport))}); }) : window.__textOriginal.call(this); }; true;`);
  await attach('input[accept=".json,application/json"]', 'demorado.json', 'pendente', 'application/json');
  await waitFor(() => js(`typeof window.__finishImport === 'function'`), 'leitura de JSON pendente');
  await click('IA'); await click('assistentes');
  await waitFor(() => js(`document.querySelector('input[accept=".json,application/json"]') !== null`), 'remontar assistentes');
  await attach('input[accept=".json,application/json"]', 'agora.json', JSON.stringify(delayedImport), 'application/json');
  await waitFor(async () => (await settings.get('assistants.custom')).length === 2, 'nova importação');
  await js(`window.__finishImport(); File.prototype.text = window.__textOriginal; true;`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await settings.get('assistants.custom')).length, 2);
  await waitFor(() => js(`document.querySelectorAll('.assistant-row [title="Excluir"]').length === 2`), 'segunda importação concluída');
  await js(`document.querySelectorAll('.assistant-row [title="Excluir"]')[1].click()`);
  await waitFor(async () => (await settings.get('assistants.custom')).length === 1, 'remover importado de teste');

  console.log('UI: perguntas simuladas');
  // Pergunta manual e perguntas sugeridas passam pelo preload e builders reais.
  await clickSelector('[title="Configurações"]');
  await setValue('.composer textarea, .composer input', 'O que sabemos?');
  await clickSelector('.composer .send-btn');
  await waitFor(() => js(`document.querySelector('.answer')?.textContent.includes('Resposta fictícia')`), 'responder');
  assert.match(requests[0].messages[0].content, /RESPOSTA_LEGADO/);
  assert.match(requests[0].messages[0].content, /Não tenho base/);
  assert.match(requests[0].messages[1].content, /Contexto legado fictício/);
  assert.match(requests[0].messages[1].content, /Perfil global fictício/);
  await waitFor(() => js(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'sugerir perguntas')`), 'botão de perguntas');
  await click('sugerir perguntas');
  await waitFor(() => js(`document.querySelector('.suggested-questions')?.textContent.includes('Como confirmar isso?')`), 'perguntas sugeridas');
  assert.equal(requests[1].mode, 'questions');
  assert.ok(!requests[1].messages[0].content.includes('RESPOSTA_LEGADO'));

  // Dispositivo de áudio fictício do Chromium; sem microfone ou loopback real.
  console.log('UI: lembrete com áudio fictício e relógio acelerado');
  await clickSelector('[title="Configurações"]');
  await click('voz');
  await waitFor(() => js(`document.querySelector('.theme-panel .option-label input') !== null`), 'opção de escuta');
  assert.equal(await js(`document.querySelector('.theme-panel .option-label input').checked`), false);
  await clickSelector('.theme-panel .option-label input');
  await clickSelector('[title="Configurações"]');
  await js(`window.__offset = 0; window.__realNow = Date.now; Date.now = () => window.__realNow() + window.__offset; true;`);
  // O teste exercita o fallback de áudio já existente, sem carregar um módulo externo.
  await js(`const RealAudioContext = window.AudioContext; window.AudioContext = class extends RealAudioContext { constructor(...args) { super(...args); Object.defineProperty(this, 'audioWorklet', { value: { addModule: async () => { throw new Error('Worklet simulado no teste'); } } }); } }; true;`);
  await js(`navigator.mediaDevices.getDisplayMedia = async () => { throw new Error('Loopback simulado como indisponível'); }; true;`);
  await clickSelector('.mic-hero');
  await waitFor(() => js(`document.querySelector('.mic-hero.listening') !== null`), 'iniciar áudio fictício');
  win.webContents.send('stt:transcription-delta', { source: 'system', text: 'Fala fictícia preservada.' });
  await waitFor(() => js(`document.querySelector('.transcript')?.textContent.includes('Fala fictícia preservada')`), 'fala fictícia');
  await js(`window.__offset = 30 * 60 * 1000; true;`);
  await waitFor(() => js(`document.querySelector('.listen-notice') !== null`), 'lembrete após 30 min');
  await click('continuar');
  await waitFor(() => js(`document.querySelector('.listen-notice') === null`), 'confirmar escuta');
  assert.equal(stoppedStt, 0);
  await js(`window.__offset += 30 * 60 * 1000; true;`);
  await waitFor(() => js(`document.querySelector('.listen-notice') !== null`), 'segundo lembrete');
  await js(`window.__offset += 61 * 1000; true;`);
  await waitFor(() => js(`document.querySelector('.hero-label')?.textContent.includes('escuta pausada')`), 'pausar após 60 s');
  assert.ok(stoppedStt >= 1);
  assert.ok(savedTranscriptions.some((t) => t.text === 'Fala fictícia preservada.'));
  assert.equal(createdSessions, 1);
  await clickSelector('.mic-hero');
  await waitFor(() => js(`document.querySelector('.mic-hero.listening') !== null`), 'retomar sessão');
  assert.equal(createdSessions, 1); assert.equal(resumedSessions, 1);
  await clickSelector('.mic-hero');
  await waitFor(() => js(`document.querySelector('.mic-hero.listening') === null`), 'encerrar áudio fictício');
  await js(`Date.now = window.__realNow; true;`);

  // Confere persistência ao recarregar a interface.
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.reload(); });
  await waitFor(() => js(`document.querySelector('.profile-row select')?.value === 'c-antigo'`), 'recarregar');
  await clickSelector('[title="Configurações"]');
  await click('assistentes');
  await clickSelector('[title="Contexto de Padrão"]');
  await waitFor(() => js(`document.querySelector('.assistant-context textarea')?.value === 'Dados fictícios do assistente pronto'`), 'persistência do pronto');
  assert.equal(await js(`document.querySelector('.assistant-context input[type=checkbox]').checked`), true);
  await new Promise((resolve) => setTimeout(resolve, 350));
  fs.writeFileSync(path.join(temp, 'interface.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  console.log('PASS: UI compilada, legado, texto/PDF em worker, limites, certeza, categorias, exportar/importar, exclusões concorrentes, extração cancelada, prompts, pausa/retomada e persistência');
  console.log(`Evidência visual e dados fictícios: ${temp}`);
  clearTimeout(timer); win.destroy(); app.quit();
}).catch((error) => { console.error(error); console.error(errors); clearTimeout(timer); if (win) win.destroy(); app.exit(1); });
