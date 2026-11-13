import React, { useEffect, useState } from 'react';
import { MCP_STAGES } from '../assistants/preferences.mjs';

export function AssistantMcpEditor({ value = {}, onChange }) {
  const [servers, setServers] = useState([]);
  useEffect(() => { let active = true;
    window.teka.mcp.list().then(items => { if (active) setServers(items); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <details className="assistant-uses mcp-assistant">
    <summary>Ferramentas deste assistente ({value.mcpServerIds?.length || 0})</summary>
    <div className="panel-note">Só nas perguntas e na tela. Cadastre servidores na aba ferramentas.</div>
    {!servers.length && <div className="panel-note">Nenhum servidor cadastrado.</div>}
    {servers.map(server => <label className="option-label" key={server.id}>
      <input type="checkbox" checked={value.mcpServerIds?.includes(server.id) || false} onChange={e => onChange({ ...value,
        mcpServerIds: e.target.checked ? [...(value.mcpServerIds || []), server.id] : (value.mcpServerIds || []).filter(id => id !== server.id) })} />
      {server.name}{server.enabled ? '' : ' · desligado'}
    </label>)}
    <details className="assistant-uses">
      <summary>Instruções das consultas (opcional)</summary>
      <div className="panel-note">Complementam as instruções padrão de cada etapa.</div>
      {MCP_STAGES.map(([stage, label]) => <label key={stage}>{label}
        <textarea className="profile-editor" rows={2} maxLength={4000} value={value.mcpInstructions?.[stage] || ''}
          onChange={e => onChange({ ...value, mcpInstructions: { ...value.mcpInstructions, [stage]: e.target.value } })} />
      </label>)}
    </details>
  </details>;
}
