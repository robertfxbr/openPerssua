const crypto = require('node:crypto');
const { McpClient } = require('./Client');

const KEY = 'mcp.servers';
const MODES = ['auto', 'confirm', 'off'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
function dictionary(value) {
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).length > 100 || Object.entries(value).some(([k, v]) =>
    !k || /[\r\n\0]/.test(k) || ['__proto__', 'prototype', 'constructor'].includes(k) || typeof v !== 'string' || v.length > 16000)) throw new Error('Mapa de ambiente ou cabeçalhos inválido');
  return Object.fromEntries(Object.entries(value));
}
function normalize(source) {
  if (!object(source) || !text(source.name, 81).trim() || source.name.length > 80) throw new Error('Informe um nome de até 80 caracteres');
  const type = source.type || (source.url ? 'http' : 'stdio');
  const config = { name: source.name.trim(), type, enabled: source.enabled === true, modes: {} };
  if (type === 'stdio') {
    if (typeof source.command !== 'string' || !source.command.trim() || source.command.length > 2000 || /[\r\n\0]/.test(source.command)) throw new Error('Comando local inválido');
    if (source.args !== undefined && (!Array.isArray(source.args) || source.args.length > 100 || source.args.some(a => typeof a !== 'string' || a.length > 16000 || /[\r\n\0]/.test(a)))) throw new Error('Argumentos inválidos');
    config.command = source.command.trim(); config.args = source.args || [];
  } else if (type === 'http') {
    let url; try { url = new URL(source.url); } catch { throw new Error('URL inválida'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4000) throw new Error('URL HTTP inválida; use cabeçalhos para autenticação');
    config.url = url.href;
  } else throw new Error('Tipo MCP não suportado');
  return config;
}
function parseImport(json) {
  if (typeof json !== 'string' || Buffer.byteLength(json) > 1024 * 1024) throw new Error('JSON grande demais (máximo 1 MB)');
  const data = JSON.parse(json, (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Chave não permitida');
    return value;
  });
  if (!object(data?.mcpServers) || Object.keys(data.mcpServers).length > 100) throw new Error('Use um JSON com mcpServers (até 100 servidores)');
  return Object.entries(data.mcpServers).map(([name, source]) => {
    const config = normalize({ ...source, name, type: source.url ? 'http' : 'stdio', enabled: false });
    return { ...config, env: dictionary(source.env), headers: dictionary(source.headers) };
  });
}

class McpManager {
  constructor({ settingsStore, safeStorage }) {
    this.store = settingsStore; this.safe = safeStorage;
    this.clients = new Map(); this.states = new Map(); this.queue = Promise.resolve(); this.disposed = false;
  }
  async configs() { return (await this.store.get(KEY)) || []; }
  mutate(work) {
    const pending = this.queue.then(work); this.queue = pending.catch(() => {}); return pending;
  }
  encrypt(env, headers) {
    const secrets = { env: dictionary(env), headers: dictionary(headers) };
    if (!Object.keys(secrets.env).length && !Object.keys(secrets.headers).length) return null;
    if (!this.safe?.isEncryptionAvailable()) throw new Error('Cifra do sistema indisponível; os segredos não foram salvos');
    return this.safe.encryptString(JSON.stringify(secrets)).toString('base64');
  }
  decrypt(config) {
    if (!config.secretEnc) return { env: {}, headers: {} };
    if (!this.safe?.isEncryptionAvailable()) throw new Error('Cifra do sistema indisponível');
    try { return JSON.parse(this.safe.decryptString(Buffer.from(config.secretEnc, 'base64'))); }
    catch { throw new Error('Não foi possível abrir os segredos deste servidor'); }
  }
  safeError(error, config) {
    let message = String(error?.message || error);
    try {
      const secrets = this.decrypt(config);
      for (const value of [...Object.values(secrets.env), ...Object.values(secrets.headers)]) {
        if (value) message = message.split(value).join('[oculto]');
        if (value?.startsWith('Bearer ')) message = message.split(value.slice(7)).join('[oculto]');
      }
    } catch { return 'Falha no servidor MCP; verifique a configuração e a cifra do sistema'; }
    return message.slice(-1500);
  }
  async list() {
    return (await this.configs()).map(({ secretEnc, ...config }) => {
      const state = this.states.get(config.id);
      const client = this.clients.get(config.id);
      return { ...config, hasSecrets: Boolean(secretEnc), status: !config.enabled ? 'off' : state?.status === 'connected' && !client?.ready ? 'error' : state?.status || 'idle',
        error: state?.status === 'connected' && !client?.ready ? 'Conexão encerrada; teste para reconectar' : state?.error,
        tools: state?.tools || [] };
    });
  }
  save(source) {
    return this.mutate(async () => {
      const all = await this.configs(); const old = all.find(c => c.id === source.id);
      const config = normalize(source);
      config.id = old?.id || crypto.randomUUID();
      config.modes = old?.modes || {};
      config.secretEnc = source.keepSecrets === true && old ? old.secretEnc : this.encrypt(source.env, source.headers);
      if (!old && all.length >= 100) throw new Error('Limite de 100 servidores');
      await this.store.set(KEY, old ? all.map(c => c.id === old.id ? config : c) : [...all, config]);
      this.stop(config.id); return config.id;
    });
  }
  import(json) {
    const configs = parseImport(json);
    return this.mutate(async () => {
      const all = await this.configs();
      if (all.length + configs.length > 100) throw new Error('Limite de 100 servidores');
      const added = configs.map(c => { const { env, headers, ...config } = c;
        return { ...config, id: crypto.randomUUID(), secretEnc: this.encrypt(env, headers) }; });
      await this.store.set(KEY, [...all, ...added]); return added.length;
    });
  }
  update(id, change) {
    return this.mutate(async () => {
      const all = await this.configs(); if (!all.some(c => c.id === id)) throw new Error('Servidor ausente');
      await this.store.set(KEY, all.map(c => c.id === id ? change(c) : c));
    });
  }
  async enable(id, enabled) { await this.update(id, c => ({ ...c, enabled: enabled === true })); this.stop(id); }
  async remove(id) { await this.mutate(async () => this.store.set(KEY, (await this.configs()).filter(c => c.id !== id))); this.stop(id); }
  async setMode(id, name, mode) {
    if (typeof name !== 'string' || name.length > 300 || !MODES.includes(mode)) throw new Error('Modo de ferramenta inválido');
    await this.update(id, c => ({ ...c, modes: { ...c.modes, [name]: mode } }));
  }
  stop(id) { this.clients.get(id)?.close(); this.clients.delete(id); this.states.delete(id); }
  async client(config) {
    if (this.disposed) throw new Error('MCP encerrado');
    let client = this.clients.get(config.id);
    if (!client) { client = new McpClient({ ...config, ...this.decrypt(config) }); this.clients.set(config.id, client); }
    return client;
  }
  async catalog(config, signal) {
    try {
      const client = await this.client(config);
      const tools = await client.listTools({ signal });
      const clean = tools.filter(t => typeof t?.name === 'string' && t.name.length <= 300 && object(t.inputSchema)).map(t => ({ name: t.name, description: text(t.description, 2000), inputSchema: t.inputSchema }));
      this.states.set(config.id, { status: 'connected', tools: clean }); return clean;
    } catch (error) {
      const message = this.safeError(error, config); this.states.set(config.id, { status: 'error', error: message });
      throw new Error(message);
    }
  }
  async test(id, signal) {
    const config = (await this.configs()).find(c => c.id === id);
    if (!config?.enabled) throw new Error('Ligue o servidor antes de testar');
    this.stop(id); await this.catalog(config, signal); return this.list();
  }
  async available(ids, signal) {
    if (!Array.isArray(ids) || !ids.length) return [];
    const selected = (await this.configs()).filter(c => c.enabled && ids.includes(c.id));
    const catalogs = await Promise.all(selected.map(async config => {
      try {
        const tools = await this.catalog(config, signal);
        return tools.map(t => ({ ...t, id: `${config.id}:${t.name}`, serverId: config.id, serverName: config.name, mode: config.modes[t.name] || 'confirm' }));
      } catch { return []; }
    }));
    return catalogs.flat();
  }
  async call(tool, args, { confirm, signal, authorize, onStart } = {}) {
    const config = (await this.configs()).find(c => c.id === tool.serverId);
    if (!config?.enabled) throw new Error('Servidor desligado');
    const mode = config.modes[tool.name] || 'confirm';
    if (mode === 'off') throw new Error('Ferramenta desligada');
    if (mode !== 'auto' && !(await confirm?.(tool, args, signal))) throw new Error('Uso negado');
    const current = (await this.configs()).find(c => c.id === tool.serverId);
    if (!current?.enabled || JSON.stringify(current) !== JSON.stringify(config)) throw new Error('A configuração mudou; faça uma nova pergunta');
    if (signal?.aborted) throw new Error('MCP cancelado');
    if (authorize && !(await authorize())) throw new Error('Servidor removido deste assistente');
    // Usa o schema do catálogo local, nunca um schema fornecido pelo modelo.
    const actual = this.states.get(config.id)?.tools.find(t => t.name === tool.name);
    if (!actual) throw new Error('Ferramenta não encontrada no catálogo');
    require('./schema').validateArguments(actual.inputSchema, args);
    try { return await (await this.client(config)).callTool(tool.name, args, { signal, onStart }); }
    catch (error) { throw new Error(this.safeError(error, config)); }
  }
  dispose() { this.disposed = true; for (const id of this.clients.keys()) this.stop(id); }
}
module.exports = { McpManager, parseImport };
