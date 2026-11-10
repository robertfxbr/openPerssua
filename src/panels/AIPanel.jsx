import React, { useEffect, useState } from 'react';

const api = window.teka;

export const TRANSLATE_TARGETS = [
  ['pt', 'PT'],
  ['en', 'EN'],
  ['es', 'ES'],
];

// Campo de configuração de um provedor (API key, endereço, modelo).
// Segredos nunca chegam aqui: o main devolve "••••••" quando existe um, e
// salvar o campo vazio apaga a chave.
function ProviderField({ field, onSaved }) {
  const [value, setValue] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings.get(field.key).then((v) => {
      if (field.secret) setHasSecret(Boolean(v));
      else setValue(v || '');
    });
  }, [field.key]);

  async function save() {
    if (field.secret && !value) return; // vazio sem querer não apaga a chave
    await api.settings.set(field.key, value.trim());
    if (field.secret) { setHasSecret(Boolean(value.trim())); setValue(''); }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onSaved?.();
  }

  async function clearSecret() {
    await api.settings.set(field.key, '');
    setHasSecret(false);
    onSaved?.();
  }

  return (
    <div className="theme-row">
      <span className="theme-label">{field.label}</span>
      <input
        className="model-input"
        type={field.secret ? 'password' : 'text'}
        value={value}
        placeholder={field.secret ? (hasSecret ? 'salva ✓ (digite para trocar)' : 'cole a chave aqui') : (field.placeholder || '')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        onBlur={save}
      />
      {field.secret && hasSecret && (
        <button className="mini-link danger" title="Apagar a chave salva" onClick={clearSecret}>✕</button>
      )}
      {saved && <span className="inline-status">✓</span>}
    </div>
  );
}

// Aba "IA": credenciais dos provedores, modelo por tarefa, memória
// compactada e tradução ao vivo.
export function AIPanel({
  providers, mainProvider, onProvidersChanged,
  compactEnabled, onCompactChange, memory,
  translate, onTranslateChange,
}) {
  const [configId, setConfigId] = useState(mainProvider || '');
  const [tasks, setTasks] = useState({});
  const [taskLabels, setTaskLabels] = useState({});
  const [showMemory, setShowMemory] = useState(false);

  useEffect(() => {
    api.llm.listTasks().then(setTaskLabels).catch(() => {});
    api.settings.get('llm.tasks').then((t) => setTasks(t || {}));
  }, []);

  useEffect(() => { if (!configId && mainProvider) setConfigId(mainProvider); }, [mainProvider]);

  const configured = providers.find((p) => p.id === configId);

  function updateTask(task, patch) {
    const next = { ...tasks, [task]: { ...(tasks[task] || {}), ...patch } };
    if (!next[task].provider && !next[task].model) delete next[task];
    setTasks(next);
    api.settings.set('llm.tasks', next);
  }

  return (
    <>
      <div className="panel-section">provedores</div>
      <div className="theme-row">
        <span className="theme-label">configurar</span>
        <div className="select-wrap grow">
          <select value={configId} onChange={(e) => setConfigId(e.target.value)}>
            <option value="">escolha um provedor…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.configured ? ' ✓' : ''}</option>
            ))}
          </select>
        </div>
      </div>
      {configured?.hint && <div className="panel-note">{configured.hint}</div>}
      {configured && !configured.configured && configured.fields.length === 0 && (
        <div className="panel-note">Ainda não encontrado neste PC (ou sem login). Depois de instalar, reabra esta aba.</div>
      )}
      {configured?.fields.map((f) => (
        <ProviderField key={f.key} field={f} onSaved={onProvidersChanged} />
      ))}
      {configured?.keyUrl && (
        <button className="mini-link" onClick={() => api.llm.openKeyPage(configured.id)}>
          criar uma API key ↗
        </button>
      )}

      <div className="panel-section">modelo por tarefa</div>
      <div className="panel-note">Vazio = usa o cérebro e o modelo principais.</div>
      {Object.entries(taskLabels).map(([task, label]) => {
        const t = tasks[task] || {};
        const prov = providers.find((p) => p.id === t.provider);
        return (
          <div key={task} className="task-row">
            <span className="task-label">{label}</span>
            <div className="select-wrap small">
              <select value={t.provider || ''} onChange={(e) => updateTask(task, { provider: e.target.value })}>
                <option value="">principal</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.label.split(' (')[0]}{p.configured ? ' ✓' : ''}</option>
                ))}
              </select>
            </div>
            <input
              className="model-input small"
              value={t.model || ''}
              placeholder={prov?.defaultModel || 'modelo'}
              onChange={(e) => updateTask(task, { model: e.target.value })}
            />
          </div>
        );
      })}

      <div className="panel-section">reuniões longas</div>
      <div className="theme-row">
        <span className="theme-label">memória</span>
        <div className="mode-pills slim">
          <button
            className={`pill ${compactEnabled ? 'active' : ''}`}
            onClick={() => onCompactChange(true)}
            title="As falas antigas viram um resumo curto que acompanha toda pergunta"
          >
            compactar
          </button>
          <button className={`pill ${!compactEnabled ? 'active' : ''}`} onClick={() => onCompactChange(false)}>
            desligada
          </button>
        </div>
      </div>
      {memory && (
        <>
          <button className="mini-link" onClick={() => setShowMemory(!showMemory)}>
            {showMemory ? 'esconder' : 'ver'} a memória desta sessão ({memory.length} caracteres)
          </button>
          {showMemory && <div className="memory-view">{memory}</div>}
        </>
      )}

      <div className="panel-section">tradução ao vivo</div>
      <div className="theme-row">
        <span className="theme-label">traduzir</span>
        <div className="mode-pills slim">
          <button
            className={`pill ${!translate.enabled ? 'active' : ''}`}
            onClick={() => onTranslateChange({ enabled: false })}
          >
            não
          </button>
          {TRANSLATE_TARGETS.map(([id, label]) => (
            <button
              key={id}
              className={`pill ${translate.enabled && translate.target === id ? 'active' : ''}`}
              onClick={() => onTranslateChange({ enabled: true, target: id })}
              title={`Mostra a tradução para ${label} embaixo de cada fala`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {translate.enabled && (
        <div className="panel-note">
          Pelas CLIs cada fala leva alguns segundos para traduzir. Para tradução, o login do ChatGPT ou o Ollama são mais rápidos (escolha em "modelo por tarefa").
        </div>
      )}
      {translate.enabled && (
        <div className="theme-row">
          <span className="theme-label">falas</span>
          <div className="mode-pills slim">
            <button
              className={`pill ${translate.sources === 'system' ? 'active' : ''}`}
              onClick={() => onTranslateChange({ sources: 'system' })}
            >
              da reunião
            </button>
            <button
              className={`pill ${translate.sources === 'all' ? 'active' : ''}`}
              onClick={() => onTranslateChange({ sources: 'all' })}
            >
              todas
            </button>
          </div>
        </div>
      )}
    </>
  );
}
