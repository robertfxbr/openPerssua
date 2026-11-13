import React, { useState } from 'react';
import { AssistantContextEditor } from './AssistantContextEditor';
import { BUILTIN_ASSISTANTS, ASSISTANT_MODES } from '../assistants/presets';

const MODE_LABEL = Object.fromEntries(ASSISTANT_MODES);
const MAX_INSTRUCTIONS = 4000;

// Aba "assistentes": escolher um pronto, duplicar para ajustar ou criar um
// do zero. Os prontos não são editáveis para sempre haver um ponto de volta.
export function AssistantsPanel({ activeId, custom, onSelect, onCustomChange, contexts, onContextChange, preferences, onPreferencesChange }) {
  const [contextId, setContextId] = useState(null);
  const [editing, setEditing] = useState(null); // { id, name, mode, instructions, isNew }

  function startNew(base) {
    setEditing({
      id: `c-${Date.now().toString(36)}`,
      name: base ? `${base.name} (cópia)` : '',
      mode: base?.mode || 'meeting',
      instructions: base?.instructions || '',
      contextCopy: base ? contexts[base.id] : undefined,
      preferencesCopy: base ? preferences[base.id] : undefined,
      isNew: true,
    });
  }

  function save() {
    const name = editing.name.trim();
    if (!name) return;
    const item = {
      id: editing.id,
      name: name.slice(0, 60),
      mode: editing.mode,
      instructions: editing.instructions.slice(0, MAX_INSTRUCTIONS),
    };
    const next = editing.isNew
      ? [...custom, item]
      : custom.map((a) => (a.id === item.id ? item : a));
    onCustomChange(next);
    if (editing.preferencesCopy) onPreferencesChange(item.id, editing.preferencesCopy);
    if (editing.contextCopy) onContextChange(item.id, editing.contextCopy);
    if (editing.isNew) onSelect(item.id);
    setEditing(null);
  }

  function remove(id) {
    onCustomChange(custom.filter((a) => a.id !== id));
    if (activeId === id) onSelect('padrao');
  }

  if (editing) {
    return (
      <div className="assistant-editor">
        <input
          className="model-input"
          value={editing.name}
          maxLength={60}
          autoFocus
          placeholder="nome do assistente"
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        />
        <div className="mode-pills slim">
          {ASSISTANT_MODES.map(([id, label]) => (
            <button
              key={id}
              className={`pill ${editing.mode === id ? 'active' : ''}`}
              onClick={() => setEditing({ ...editing, mode: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          className="profile-editor"
          rows={5}
          value={editing.instructions}
          maxLength={MAX_INSTRUCTIONS}
          placeholder="Como o copiloto deve agir: tom, foco, o que evitar. Ex.: responda sempre em tópicos e puxe para o próximo passo."
          onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
        />
        <div className="ob-nav">
          <button className="auth-link" onClick={() => setEditing(null)}>cancelar</button>
          <div style={{ flex: 1 }} />
          <button className="send-btn wide" onClick={save} disabled={!editing.name.trim()}>salvar</button>
        </div>
      </div>
    );
  }

  const row = (a, builtin) => (
    <React.Fragment key={a.id}><div className={`assistant-row ${activeId === a.id ? 'active' : ''}`}>
      <button className="assistant-pick" onClick={() => onSelect(a.id)} title={a.instructions || 'Sem instruções extras'}>
        <span className="assistant-name">{activeId === a.id ? '● ' : ''}{a.name}</span>
        <span className="history-meta">{a.mode ? MODE_LABEL[a.mode] : 'mantém o modo'}{builtin ? '' : ' · seu'}</span>
      </button>
      <button className="mini-link" title={`Contexto de ${a.name}`} onClick={() => setContextId(contextId === a.id ? null : a.id)}>contexto</button>
      {builtin
        ? a.id !== 'padrao' && <button className="mini-link" title="Duplicar para editar" onClick={() => startNew(a)}>⧉</button>
        : (
          <>
            <button className="mini-link" title="Editar" onClick={() => setEditing({ ...a, isNew: false })}>✎</button>
            <button className="mini-link danger" title="Excluir" onClick={() => remove(a.id)}>🗑</button>
          </>
        )}
    </div>
    {contextId === a.id && <div className="assistant-context">
      <label className="option-label"><input type="checkbox" checked={preferences[a.id]?.certainOnly === true}
        onChange={(e) => onPreferencesChange(a.id, { certainOnly: e.target.checked })} /> Responder só com certeza</label>
      <div className="panel-note">Usa apenas a transcrição e os contextos. Se faltar base, avisa.</div>
      <AssistantContextEditor key={a.id} value={contexts[a.id]} onChange={(value) => onContextChange(a.id, value)} />
    </div>}
    </React.Fragment>
  );

  return (
    <>
      <div className="assistant-list">
        {BUILTIN_ASSISTANTS.map((a) => row(a, true))}
        {custom.map((a) => row(a, false))}
      </div>
      <button className="chip" onClick={() => startNew(null)}>+ novo assistente</button>
    </>
  );
}
