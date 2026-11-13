// Provedores simulados: nenhum token real, subprocesso ou serviço é chamado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { reasoningOptions, effortCandidates, cliEffortArgs } = require('../electron/llm/reasoning');

(async () => {
  assert.deepEqual(reasoningOptions({ mode: 'assist' }, true), { fast: true, thinkMore: false });
  assert.equal(reasoningOptions({ mode: 'screen' }, true).thinkMore, true);
  assert.equal(reasoningOptions({}, true).thinkMore, true);
  assert.equal(reasoningOptions({ mode: 'summary' }, true).thinkMore, false);
  assert.equal(reasoningOptions({}, false).thinkMore, false);
  assert.deepEqual(effortCandidates({ fast: true, thinkMore: true }).slice(0, 3), ['none', 'minimal', 'low']);
  assert.equal(effortCandidates({ thinkMore: true })[0], 'medium');
  assert.deepEqual(cliEffortArgs('codex', 'medium', '--config <key=value>'), ['-c', 'model_reasoning_effort=medium']);
  assert.deepEqual(cliEffortArgs('claude', 'low', '--effort <level>'), ['--effort', 'low']);
  assert.deepEqual(cliEffortArgs('claude', 'medium', 'versão antiga'), []);
  assert.deepEqual(cliEffortArgs('gemini', 'medium', 'sem esforço'), []);

  const requests = [];
  let accept = 'low';
  const context = { module: { exports: {} }, require: (name) => name === 'electron' ? {} :
    name === '../messageFormat' ? require('../electron/llm/messageFormat') :
    name === './OpenAIAdapter' ? require('../electron/llm/providers/OpenAIAdapter') :
    name === '../reasoning' ? require('../electron/llm/reasoning') : require(name),
    Buffer, URLSearchParams, setTimeout, clearTimeout, fetch: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (body.reasoning?.effort !== accept) return new Response('unsupported reasoning effort', { status: 400 });
      return new Response('data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: [DONE]\n\n');
    } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/llm/providers/ChatGPTOAuthAdapter'), 'utf8'), context);
  const adapter = new context.module.exports.ChatGPTOAuthAdapter({ tokenStore: {} });
  adapter.getValidToken = async () => ({ access_token: 'teste.local' });
  const req = { messages: [{ role: 'user', content: 'Teste' }], model: 'modelo-teste', thinkMore: true };
  assert.equal(await adapter.chat(req), 'OK');
  assert.deepEqual(requests.map((r) => r.reasoning?.effort), ['medium', 'high', 'low']);
  requests.length = 0;
  await adapter.chat(req);
  assert.deepEqual(requests.map((r) => r.reasoning?.effort), ['low']);
  accept = 'none'; requests.length = 0;
  await adapter.chat({ ...req, model: 'rapido', fast: true });
  assert.equal(requests[0].reasoning.effort, 'none');
  accept = undefined; requests.length = 0;
  await adapter.chat({ ...req, model: 'sem-esforco' });
  assert.ok(!('reasoning' in requests.at(-1)));
  console.log('PASS: roteamento manual/ao vivo, CLIs e recuo OAuth com cache e omissão');
})().catch((e) => { console.error(e); process.exitCode = 1; });
