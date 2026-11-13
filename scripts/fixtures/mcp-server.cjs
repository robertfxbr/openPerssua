// Servidor de teste local, sem dependências e sem acesso a dados do usuário.
const http = require('node:http');
const readline = require('node:readline');
const tools = [
  { name: 'somar', description: 'Soma dois números.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'buscar_nota', description: 'Busca uma nota de teste.', inputSchema: { type: 'object', properties: { termo: { type: 'string' } }, required: ['termo'] } },
];
let initialized = false;
async function reply(msg) {
  if (msg.method === 'initialize' && process.argv.includes('--hang-initialize')) await new Promise(r => setTimeout(r, 5000));
  if (msg.method === 'notifications/initialized') { initialized = true; return; }
  if (msg.id === undefined) return;
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: process.argv.includes('--invalid-version') ? '2099-01-01' : msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'teste', version: '1' } };
  else if (!initialized) return { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Sem inicialização' } };
  else if (msg.method === 'tools/list') result = msg.params?.cursor ? { tools: tools.slice(1) } : { tools: tools.slice(0, 1), nextCursor: 'segunda' };
  else if (msg.method === 'tools/call') {
    const args = msg.params.arguments;
    if (args.termo === 'morrer') { process.exit(7); }
    if (args.termo === 'lento') await new Promise(r => setTimeout(r, 2000));
    if (args.termo === 'stderr') process.stderr.write('x'.repeat(2 * 1024 * 1024));
    result = { content: [{ type: 'text', text: msg.params.name === 'somar' ? String(args.a + args.b) : `Nota: ${args.termo}` }], ...(args.termo === 'erro' ? { isError: true } : {}) };
  } else return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Método ausente' } };
  return { jsonrpc: '2.0', id: msg.id, result };
}
if (process.argv.includes('--http')) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    if (!req.headers.accept?.includes('application/json') || !req.headers.accept?.includes('text/event-stream')) { res.writeHead(406).end(); return; }
    if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== 'teste-sessao') { res.writeHead(404).end(); return; }
    if (process.env.MCP_TEST_TOKEN && req.headers.authorization !== process.env.MCP_TEST_TOKEN) { res.writeHead(401).end(); return; }
    const result = await reply(msg);
    res.setHeader('Mcp-Session-Id', 'teste-sessao');
    if (!result) { res.writeHead(202).end(); return; }
    if (msg.method === 'tools/call') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': comentário\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n');
      res.write(`event: message\r\ndata: ${JSON.stringify(result)}\r\n\r\n`);
      // Mantém aberto para provar que o cliente resolve ao receber o id esperado.
      const timer = setTimeout(() => res.end(), 2000); res.on('close', () => clearTimeout(timer));
    } else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1', () => console.log(server.address().port));
} else readline.createInterface({ input: process.stdin }).on('line', async line => {
  const result = await reply(JSON.parse(line)); if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
});
