import React, { useEffect, useState } from 'react';

const api = window.teka.mcp;
const EMPTY = { name: '', type: 'stdio', command: '', args: '[]', env: '{}', url: '', headers: '{}' };
const STATES = { connected: 'conectado', error: 'erro', off: 'desligado', idle: 'ainda não conectado' };

export function ToolsPanel() {
  const [servers, setServers] = useState([]), [editing, setEditing] = useState(null);
  const [json, setJson] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const refresh = () => api.list().then(setServers);
  useEffect(() => {
    let active = true;
    const load = () => api.list().then(items => { if (active) setServers(items); }).catch(e => { if (active) setNotice(e.message); });
    load(); const timer = setInterval(load, 4000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function act(work, success = '') {
    if (busy) return;
    setBusy(true); setNotice('');
    try { await work(); await refresh(); setNotice(success); }
    catch (e) { setNotice(String(e.message || e)); }
    finally { setBusy(false); }
  }
  async function save() {
    await act(async () => {
      await api.save({ ...editing, args: JSON.parse(editing.args || '[]'),
        env: editing.keepSecrets ? undefined : JSON.parse(editing.env || '{}'),
        headers: editing.keepSecrets ? undefined : JSON.parse(editing.headers || '{}') });
      setEditing(null);
    }, 'Servidor salvo. Ligue e teste quando quiser.');
  }
  const field = (key, label, multiline = false, placeholder) => <label className="mcp-field">{label}
    {multiline ? <textarea className="profile-editor" rows={2} aria-label={label} value={editing[key]} placeholder={placeholder}
      maxLength={64000} onChange={e => setEditing({ ...editing, [key]: e.target.value })} />
      : <input className="model-input" aria-label={label} value={editing[key]} placeholder={placeholder} maxLength={4000}
        onChange={e => setEditing({ ...editing, [key]: e.target.value })} />}
  </label>;
  return <div className="mcp-panel">
    <div className="panel-note">Ferramentas externas para perguntas e tela. Cada assistente escolhe quais servidores pode usar.</div>
    {servers.map(server => <details className="mcp-server" key={server.id}>
      <summary>{server.name} <span className="history-meta">· {STATES[server.status]}</span></summary>
      {server.error && <div className="mcp-error" role="status">{server.error}</div>}
      <div className="assistant-filters">
        <button className="chip" disabled={busy} onClick={() => act(() => api.enable(server.id, !server.enabled))}>{server.enabled ? 'desligar' : 'ligar'}</button>
        <button className="chip" disabled={busy || !server.enabled} onClick={() => act(() => api.test(server.id), 'Conexão testada.')}>testar / reconectar</button>
        <button className="mini-link" disabled={busy} onClick={() => setEditing({ ...EMPTY, ...server, args: JSON.stringify(server.args || []), keepSecrets: server.hasSecrets })}>editar</button>
        <button className="mini-link danger" disabled={busy} onClick={() => act(() => api.remove(server.id))}>excluir</button>
      </div>
      {!server.tools.length && <div className="panel-note">Teste a conexão para listar as ferramentas.</div>}
      {server.tools.map(tool => <div className="mcp-tool" key={tool.name}>
        <strong>{tool.name}</strong><div className="panel-note">{tool.description || 'Sem descrição.'}</div>
        <select aria-label={`Modo de ${tool.name}`} value={server.modes[tool.name] || 'confirm'} disabled={busy}
          onChange={e => act(() => api.setMode(server.id, tool.name, e.target.value))}>
          <option value="confirm">pedir confirmação</option><option value="auto">automático</option><option value="off">desligada</option>
        </select>
      </div>)}
    </details>)}
    {!servers.length && <div className="panel-note">Nenhum servidor cadastrado.</div>}
    <button className="chip" disabled={busy} onClick={() => setEditing({ ...EMPTY })}>+ adicionar servidor</button>
    {editing && <fieldset className="mcp-form" disabled={busy}>
      <legend>{editing.id ? 'Editar servidor' : 'Novo servidor'}</legend>
      {field('name', 'Nome')}
      <label className="mcp-field">Tipo<select aria-label="Tipo de servidor" value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value })}>
        <option value="stdio">comando local</option><option value="http">URL HTTP</option>
      </select></label>
      {editing.type === 'stdio' ? <>{field('command', 'Comando', false, 'npx ou caminho do executável')}{field('args', 'Argumentos (array JSON)', true, '["-y", "pacote-do-servidor"]')}</> : field('url', 'URL', false, 'https://servidor.exemplo/mcp')}
      {editing.hasSecrets && <label className="option-label"><input type="checkbox" checked={editing.keepSecrets || false}
        onChange={e => setEditing({ ...editing, keepSecrets: e.target.checked })} /> Manter ambiente e cabeçalhos salvos</label>}
      {!editing.keepSecrets && (editing.type === 'stdio' ? field('env', 'Variáveis de ambiente (objeto JSON)', true, '{"TOKEN":"..."}') : field('headers', 'Cabeçalhos (objeto JSON)', true, '{"Authorization":"Bearer ..."}'))}
      <div className="panel-note">Ambiente e cabeçalhos ficam cifrados neste computador. Comandos locais executam programas com seu usuário.</div>
      <div className="assistant-filters"><button className="chip" onClick={save}>salvar servidor</button><button className="mini-link" onClick={() => setEditing(null)}>cancelar</button></div>
    </fieldset>}
    <details className="assistant-uses">
      <summary>Importar servidores</summary>
      <textarea className="profile-editor" rows={3} aria-label="JSON de servidores MCP" maxLength={1024 * 1024} value={json} onChange={e => setJson(e.target.value)} placeholder={'{"mcpServers": {...}}'} />
      <div className="assistant-filters">
        <button className="chip" disabled={busy || !json.trim()} onClick={() => act(async () => { await api.import(json); setJson(''); }, 'Importado. Os servidores começam desligados.')}>importar texto</button>
        <label className="chip attach-label">escolher JSON<input type="file" disabled={busy} accept=".json,application/json" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (file) act(async () => { if (file.size > 1024 * 1024) throw new Error('Máximo de 1 MB.'); await api.import(await file.text()); }, 'Importado. Os servidores começam desligados.');
        }} /></label>
      </div>
    </details>
    {busy && <div className="panel-note" role="status">aguarde…</div>}
    {notice && <div className="mcp-error" role="status">{notice}</div>}
  </div>;
}
