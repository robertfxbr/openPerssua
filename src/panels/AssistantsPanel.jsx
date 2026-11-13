import React, { useEffect, useRef, useState } from 'react';
import { serializeAssistants, parseAssistantImport, MAX_TRANSFER_BYTES, MAX_CUSTOM_ASSISTANTS } from '../assistants/transfer.mjs';
import { normalizeAssistant, INSTRUCTION_USES, DEFAULT_CATEGORIES, filterAssistants, categoryCounts } from '../assistants/model.mjs';
import { AssistantContextEditor } from './AssistantContextEditor';
import { AssistantMcpEditor } from './AssistantMcpEditor';
import { BUILTIN_ASSISTANTS, ASSISTANT_MODES } from '../assistants/presets';

const MODE_LABEL = Object.fromEntries(ASSISTANT_MODES);
const MAX_INSTRUCTIONS = 4000;

// Aba "assistentes": escolher um pronto, duplicar para ajustar ou criar um
// do zero. Os prontos não são editáveis para sempre haver um ponto de volta.
export function AssistantsPanel({ activeId, custom, onSelect, onCustomChange, contexts, onContextChange, preferences, onPreferencesChange, onImport, onError }) {
  const [transferNotice, setTransferNotice] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [saving, setSaving] = useState(false);
  const mutationRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const all = [...BUILTIN_ASSISTANTS, ...custom];
  const counts = categoryCounts(all, query);
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...all.map((a) => normalizeAssistant(a).category)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const [contextId, setContextId] = useState(null);
  const [editing, setEditing] = useState(null); // { id, name, mode, instructions, isNew }

  function startNew(base) {
    setEditing({
      id: `c-${crypto.randomUUID()}`,
      name: base ? `${base.name} (cópia)` : '',
      mode: base?.mode || 'meeting',
      category: normalizeAssistant(base).category,
      instructions: base?.instructions || '',
      instructionsByUse: normalizeAssistant(base).instructionsByUse,
      contextCopy: base ? contexts[base.id] : undefined,
      preferencesCopy: base ? preferences[base.id] : undefined,
      isNew: true,
    });
  }

  async function save() {
    if (mutationRef.current) return;
    const name = editing.name.trim();
    if (!name) return;
    const item = normalizeAssistant({ ...editing, name });
    const next = editing.isNew
      ? [...custom, item]
      : custom.map((a) => (a.id === item.id ? item : a));
    mutationRef.current = true; setSaving(true);
    try {
      await onCustomChange(next);
      if (editing.preferencesCopy) await onPreferencesChange(item.id, editing.preferencesCopy);
      if (editing.contextCopy) await onContextChange(item.id, editing.contextCopy);
      if (editing.isNew) onSelect(item.id, item);
      setEditing(null);
    } catch (e) { onError(`assistente: ${e.message}`); }
    finally { mutationRef.current = false; setSaving(false); }
  }

  async function remove(id) {
    if (mutationRef.current) return;
    mutationRef.current = true; setSaving(true);
    try {
      await onCustomChange(custom.filter((a) => a.id !== id));
      if (activeId === id) onSelect('padrao');
    } catch (e) { onError(`assistente: ${e.message}`); }
    finally { mutationRef.current = false; setSaving(false); }
  }

  function exportFile() {
    try {
      const json = serializeAssistants(custom, contexts, preferences);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `teka-assistentes-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferNotice('JSON preparado com os assistentes próprios e seus contextos.');
    } catch (e) { setTransferNotice(e.message); }
  }

  async function importFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || mutationRef.current) return;
    mutationRef.current = true;
    setTransferring(true);
    try {
      if (file.size > MAX_TRANSFER_BYTES) throw new Error('Arquivo grande demais (máximo de 20 MB).');
      const text = await file.text();
      if (!mounted.current) return;
      const items = parseAssistantImport(text, custom.map((a) => a.id));
      await onImport(items);
      setQuery(''); setCategory('');
      setTransferNotice(`${items.length} assistente(s) importado(s). Os existentes foram mantidos.`);
    } catch (e) { setTransferNotice(e.message); }
    finally { mutationRef.current = false; setTransferring(false); }
  }

  if (transferring) return <div className="panel-note" role="status">importando assistentes…</div>;
  if (saving) return <div className="panel-note" role="status">salvando assistentes…</div>;

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
        <label className="assistant-category">Categoria
          <input className="model-input" list="assistant-categories" value={editing.category || 'Geral'} maxLength={40}
            placeholder="escolha ou escreva uma nova" onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
          <datalist id="assistant-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
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
        <div className="panel-note">Instruções gerais · valem para todos os usos</div>
        <textarea
          className="profile-editor"
          rows={5}
          aria-label="Instruções gerais"
          value={editing.instructions || ''}
          maxLength={MAX_INSTRUCTIONS}
          placeholder="Como o copiloto deve agir: tom, foco, o que evitar. Ex.: responda sempre em tópicos e puxe para o próximo passo."
          onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
        />
        <details className="assistant-uses">
          <summary>Instruções por uso (opcional)</summary>
          <div className="panel-note">Somadas às gerais só no uso indicado.</div>
          {INSTRUCTION_USES.map(([key, label]) => <label key={key}>{label}
            <textarea className="profile-editor" rows={3} maxLength={MAX_INSTRUCTIONS}
              value={editing.instructionsByUse?.[key] || ''}
              onChange={(e) => setEditing({ ...editing, instructionsByUse: { ...editing.instructionsByUse, [key]: e.target.value } })} />
          </label>)}
        </details>
        <AssistantMcpEditor value={editing.preferencesCopy} onChange={value => setEditing({ ...editing, preferencesCopy: value })} />
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
        <span className="history-meta">{a.mode ? MODE_LABEL[a.mode] : 'mantém o modo'}{builtin ? '' : ' · seu'} · {normalizeAssistant(a).category}</span>
      </button>
      <button className="mini-link" title={`Contexto de ${a.name}`} onClick={() => setContextId(contextId === a.id ? null : a.id)}>contexto</button>
      {builtin
        ? a.id !== 'padrao' && <button className="mini-link" title="Duplicar para editar" disabled={custom.length >= MAX_CUSTOM_ASSISTANTS} onClick={() => startNew(a)}>⧉</button>
        : (
          <>
            <button className="mini-link" title="Editar" onClick={() => setEditing({ ...normalizeAssistant(a), preferencesCopy: preferences[a.id], isNew: false })}>✎</button>
            <button className="mini-link danger" title="Excluir" onClick={() => remove(a.id)}>🗑</button>
          </>
        )}
    </div>
    {contextId === a.id && <div className="assistant-context">
      <label className="option-label"><input type="checkbox" checked={preferences[a.id]?.certainOnly === true}
        onChange={(e) => onPreferencesChange(a.id, { ...preferences[a.id], certainOnly: e.target.checked })} /> Responder só com certeza</label>
      <div className="panel-note">Usa apenas a transcrição e os contextos. Se faltar base, avisa.</div>
      <AssistantContextEditor key={a.id} value={contexts[a.id]} onChange={(value) => onContextChange(a.id, value)} />
      <AssistantMcpEditor value={preferences[a.id]} onChange={value => onPreferencesChange(a.id, value)} />
    </div>}
    </React.Fragment>
  );

  return (
    <>
      <div className="assistant-filters">
        <input className="model-input" aria-label="Buscar assistente pelo nome" placeholder="buscar por nome" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
        <div className="select-wrap small"><select aria-label="Filtrar categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas ({filterAssistants(all, query).length})</option>
          {[...new Set([...counts.keys(), ...(category ? [category] : [])])].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((c) => <option key={c} value={c}>{c} ({counts.get(c) || 0})</option>)}
        </select></div>
      </div>
      <div className="assistant-list">
        {filterAssistants(all, query, category).map((a) => row(a, BUILTIN_ASSISTANTS.some((b) => b.id === a.id)))}
        {!filterAssistants(all, query, category).length && <div className="panel-note">Nenhum assistente encontrado.</div>}
      </div>
      <div className="assistant-filters">
        <button className="chip" disabled={custom.length >= MAX_CUSTOM_ASSISTANTS} onClick={() => startNew(null)}>+ novo assistente</button>
        <button className="mini-link" disabled={!custom.length} onClick={exportFile}>exportar JSON</button>
        <label className="chip attach-label">importar JSON<input type="file" accept=".json,application/json" onChange={importFile} /></label>
      </div>
      <div className="panel-note">O JSON inclui os contextos dos assistentes próprios.</div>
      {transferNotice && <div className="panel-note" role="status">{transferNotice}</div>}
    </>
  );
}
