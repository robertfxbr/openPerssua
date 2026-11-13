const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const MAX_WIRE = 4 * 1024 * 1024;
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// O cmd precisa de escape próprio, além das aspas de argumentos do Windows.
function spawnCommand(command, args, env) {
  if (process.platform !== 'win32' || !(/\.(cmd|bat)$/i.test(command) || /(?:^|[\\/])(npx|npm|uvx)$/i.test(command))) {
    return spawn(command, args, { env, windowsHide: true, stdio: 'pipe' });
  }
  const escape = value => value.replace(/([()%!^"<>&|;, *?])/g, '^$1');
  const quote = value => escape(escape(`"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`));
  const line = `${escape(command)} ${args.map(quote).join(' ')}`;
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    env, windowsHide: true, windowsVerbatimArguments: true, stdio: 'pipe',
  });
}

class McpClient {
  constructor(config, { connectTimeout = 10000, callTimeout = 20000 } = {}) {
    this.config = config; this.connectTimeout = connectTimeout; this.callTimeout = callTimeout;
    this.nextId = 0; this.pending = new Map(); this.requests = new Set(); this.stderr = '';
    this.ready = false; this.child = null; this.sessionId = null;
  }

  async connect({ signal } = {}) {
    if (signal?.aborted) throw new Error('MCP cancelado');
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        if (this.config.type === 'stdio') this.startChild();
        const result = await this.request('initialize', {
          protocolVersion: VERSIONS[0], capabilities: {}, clientInfo: { name: 'Teka', version: '1.0' },
        }, { signal, timeout: this.connectTimeout });
        if (!VERSIONS.includes(result?.protocolVersion)) throw new Error('Versão MCP não suportada');
        if (!result.capabilities?.tools) throw new Error('Servidor MCP não oferece ferramentas');
        this.protocolVersion = result.protocolVersion;
        await this.notify('notifications/initialized', {}, { signal, timeout: this.connectTimeout });
        this.ready = true;
      } catch (error) { this.close(); throw error; }
      finally { this.connecting = null; }
    })();
    return this.connecting;
  }

  startChild() {
    if (this.child) return;
    this.stderr = '';
    const environment = new Map();
    for (const [key, value] of Object.entries({ ...process.env, ...this.config.env })) {
      // No Windows, PATH e Path são a mesma variável; a opção do usuário vence.
      const canonical = process.platform === 'win32' ? key.toUpperCase() : key;
      environment.set(canonical, value);
    }
    const child = spawnCommand(this.config.command, this.config.args || [], Object.fromEntries(environment));
    this.child = child;
    const decoder = new StringDecoder('utf8'); let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > MAX_WIRE) { this.fail(new Error('Mensagem MCP grande demais')); this.close(); return; }
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); }
        catch { this.fail(new Error('Resposta MCP inválida')); this.close(); return; }
      }
    });
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString('utf8')).slice(-4000); });
    child.stdin.on('error', error => this.fail(error));
    child.on('error', error => { this.fail(error); if (this.child === child) { this.child = null; this.ready = false; } });
    child.on('close', code => {
      if (this.child !== child) return;
      this.child = null; this.ready = false;
      this.fail(new Error(`Processo MCP encerrou (${code}). ${this.stderr}`));
    });
  }

  receive(message) {
    if (Array.isArray(message)) { message.forEach(m => this.receive(m)); return; }
    if (message?.jsonrpc !== '2.0') throw new Error('JSON-RPC inválido');
    if (message.method && message.id !== undefined) {
      // Recursos, sampling e outros pedidos do servidor não são executados.
      this.write({ jsonrpc: '2.0', id: message.id, ...(message.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'Método não suportado' } }) });
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending) message.error ? pending.reject(new Error(String(message.error.message || 'Erro MCP'))) : pending.resolve(message.result);
  }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('Processo MCP indisponível');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async http(message, signal) {
    const headers = { ...this.config.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(this.protocolVersion ? { 'MCP-Protocol-Version': this.protocolVersion } : {}),
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}) };
    const response = await fetch(this.config.url, { method: 'POST', headers, body: JSON.stringify(message), signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) { this.ready = false; this.sessionId = null; }
      throw new Error(`MCP HTTP ${response.status}`);
    }
    const session = response.headers.get('mcp-session-id'); if (session) this.sessionId = session;
    if (message.id === undefined) { await response.body?.cancel(); return; }
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    let buffer = '', size = 0;
    const match = data => {
      const messages = Array.isArray(data) ? data : [data];
      return messages.find(m => m.jsonrpc === '2.0' && m.id === message.id && !m.method);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length; if (size > MAX_WIRE) throw new Error('Resposta MCP grande demais');
        buffer += decoder.decode(value, { stream: true });
        if (sse) {
          let separator;
          while ((separator = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, separator.index); buffer = buffer.slice(separator.index + separator[0].length);
            const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const found = match(JSON.parse(data)); if (found) return found;
          }
        }
      }
      if (!sse) { const found = match(JSON.parse(buffer)); if (found) return found; }
      throw new Error('Resposta MCP sem o id esperado');
    } finally { await reader.cancel().catch(() => {}); }
  }

  async notify(method, params, options = {}) {
    return this.request(method, params, { ...options, notification: true });
  }

  request(method, params, { signal, timeout = this.callTimeout, notification = false } = {}) {
    if (signal?.aborted) return Promise.reject(new Error('MCP cancelado'));
    const id = ++this.nextId;
    const message = { jsonrpc: '2.0', ...(notification ? {} : { id }), method, params };
    const controller = new AbortController(); this.requests.add(controller);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        signal?.removeEventListener('abort', abort); this.pending.delete(id); this.requests.delete(controller);
        error ? reject(error) : resolve(result);
      };
      const cancel = error => {
        finish(error); controller.abort();
        if (!notification) this.notify('notifications/cancelled', { requestId: id, reason: 'Cancelado pelo cliente' }, { timeout: 1000 }).catch(() => {});
      };
      const abort = () => cancel(new Error('MCP cancelado'));
      const timer = setTimeout(() => cancel(new Error('Tempo limite MCP excedido')), timeout);
      signal?.addEventListener('abort', abort, { once: true });
      controller.signal.addEventListener('abort', () => finish(new Error('MCP cancelado')), { once: true });
      if (this.config.type === 'http') {
        this.http(message, controller.signal).then(response => {
          if (response?.error) finish(new Error(String(response.error.message || 'Erro MCP')));
          else finish(null, response?.result);
        }, error => finish(error));
      } else {
        if (!notification) this.pending.set(id, { resolve: r => finish(null, r), reject: e => finish(e) });
        try { this.write(message); if (notification) finish(); } catch (error) { finish(error); }
      }
    });
  }

  async listTools(options = {}) {
    await this.connect(options);
    const tools = []; const cursors = new Set(); let cursor;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {}, options);
      if (!Array.isArray(page?.tools)) throw new Error('Lista MCP inválida');
      tools.push(...page.tools);
      if (tools.length > 500 || cursors.size > 100) throw new Error('Catálogo MCP grande demais');
      cursor = page.nextCursor;
      if (cursor) { if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Paginação MCP inválida'); cursors.add(cursor); }
    } while (cursor);
    return tools;
  }

  async callTool(name, args, options = {}) {
    await this.connect(options);
    return this.request('tools/call', { name, arguments: args }, options);
  }

  fail(error) { for (const p of [...this.pending.values()]) p.reject(error); }

  close() {
    this.ready = false; this.sessionId = null; this.protocolVersion = null;
    this.fail(new Error('Conexão MCP encerrada'));
    for (const controller of this.requests) controller.abort(); this.requests.clear();
    const child = this.child; this.child = null;
    if (!child) return;
    child.stdin.end();
    if (process.platform === 'win32' && child.pid) {
      // Só a árvore criada por este cliente: cmd/npx podem deixar netos vivos.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill('SIGKILL');
  }
}

module.exports = { McpClient, spawnCommand };
