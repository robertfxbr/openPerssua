const { orchestrationMessages } = require('./prompts');
const { validateArguments } = require('./schema');
const manual = req => [undefined, 'chat', 'screen'].includes(req.mode);

// O deadline também cobre provedores que não respeitam AbortSignal.
function bounded(work, signal) {
  if (signal.aborted) return Promise.reject(new Error('MCP cancelado'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('MCP cancelado'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('MCP cancelado');
      return typeof work === 'function' ? work() : work;
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function parse(stage, raw) {
  const data = JSON.parse(String(raw));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON inválido');
  if (stage === 'result') {
    if (typeof data.context !== 'string' || data.context.length > 4000) throw new Error('Resumo inválido');
  } else if (data.action !== 'answer' && !(data.action === 'call' && typeof data.tool === 'string' && data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments))) throw new Error('Decisão inválida');
  return data;
}
async function orchestrate({ req, manager, chat, confirm, signal, onUsed = () => {}, totalMs = 60000 }) {
  const used = [], results = [];
  if (!manual(req) || !req.mcpServerIds?.length) return { context: '', used };
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, totalMs);
  const active = controller.signal;
  const json = async (stage, data) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = orchestrationMessages(stage, data, req.mcpInstructions?.[stage]);
      if (attempt) messages[0].content += '\nA resposta anterior não respeitou o formato. Corrija e devolva apenas o JSON exigido.';
      try { return parse(stage, await bounded(() => chat(messages, active), active)); }
      catch (error) { if (active.aborted || attempt) throw error; }
    }
  };
  try {
    const tools = (await bounded(() => manager.available(req.mcpServerIds, active), active)).filter(t => t.mode !== 'off').slice(0, 100);
    if (!tools.length) return { context: '', used };
    const base = { question: String(req.question || '').slice(0, 4000), transcript: JSON.stringify(req.transcript || []).slice(-12000),
      context: [req.memory, req.context, req.assistantContext, req.profile].filter(Boolean).join('\n').slice(0, 24000),
      tools: tools.map(t => ({ id: t.id, name: t.name, description: String(t.description || '').slice(0, 800), inputSchema: JSON.stringify(t.inputSchema).slice(0, 2500) })) };
    let decision = await json('choice', base);
    for (let count = 0; decision.action === 'call' && count < 3; count++) {
      const tool = tools.find(t => t.id === decision.tool);
      if (!tool) break;
      validateArguments(tool.inputSchema, decision.arguments);
      if (JSON.stringify(decision.arguments).length > 16000) break;
      let raw;
      let attempt;
      const onStart = () => {
        attempt = { serverId: tool.serverId, serverName: tool.serverName, name: tool.name, isError: false, pending: true };
        used.push(attempt); onUsed([...used]);
      };
      try {
        const result = await bounded(() => manager.call(tool, decision.arguments, { confirm, signal: active, onStart }), active);
        if (!attempt) onStart();
        attempt.pending = false; attempt.isError = result?.isError === true;
        onUsed([...used]);
        raw = JSON.stringify(result).slice(0, 12000);
      } catch (error) {
        if (attempt) { attempt.pending = false; attempt.isError = true; onUsed([...used]); }
        if (!active.aborted || attempt) results.push({ tool: tool.id, isError: true, context: `Consulta não concluída; o resultado não foi confirmado: ${String(error.message).slice(0, 1500)}` });
        break;
      }
      // Preserva a evidência mesmo se acabar o prazo ou o resumo falhar.
      const item = { tool: tool.id, isError: used.at(-1).isError, context: raw }; results.push(item);
      const summary = await json('result', { question: base.question, tool: tool.id, raw });
      item.context = summary.context.slice(0, 2000);
      if (count === 2) break;
      decision = await json('next', { ...base, results });
    }
  } catch { /* JSON inválido, cancelamento ou prazo: responde com o que já obteve. */ }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  return { context: results.length ? JSON.stringify(results).slice(0, 36000) : '', used };
}
module.exports = { orchestrate, validateArguments, manual, bounded };
