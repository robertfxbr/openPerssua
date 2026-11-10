import React, { useEffect, useRef, useState } from 'react';
import { acceleratorFromEvent, prettyAccelerator } from '../util/accelerator';

const api = window.openperssua;

// Aba "atalhos" do painel de configurações: lista cada ação com a
// combinação atual e permite gravar outra, desativar ou voltar ao padrão.
export function ShortcutsPanel({ onChange }) {
  const [items, setItems] = useState([]);
  const [recording, setRecording] = useState(null); // id da ação sendo gravada
  const [feedback, setFeedback] = useState(null);   // { id, text, error }
  const recordingRef = useRef(null);

  useEffect(() => {
    api.shortcuts.list().then(setItems).catch(() => {});
  }, []);

  // Sai do modo gravação se o painel fechar no meio: sem isso os atalhos
  // globais ficariam desligados até reiniciar o app.
  useEffect(() => () => {
    if (recordingRef.current) api.shortcuts.suspend(false);
  }, []);

  function applyList(list) {
    setItems(list);
    onChange?.(list);
  }

  async function startRecording(id) {
    setFeedback(null);
    await api.shortcuts.suspend(true);
    recordingRef.current = id;
    setRecording(id);
  }

  async function stopRecording() {
    recordingRef.current = null;
    setRecording(null);
    await api.shortcuts.suspend(false);
  }

  async function save(id, accelerator) {
    const r = await api.shortcuts.set(id, accelerator);
    await stopRecording();
    if (r?.ok) {
      applyList(r.shortcuts);
      setFeedback({ id, text: 'salvo' });
    } else {
      setFeedback({ id, text: r?.error || 'não foi possível salvar', error: true });
      api.shortcuts.list().then(setItems).catch(() => {});
    }
  }

  // Captura de teclas enquanto grava. Esc cancela.
  useEffect(() => {
    if (!recording) return undefined;
    const onKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { stopRecording(); return; }
      const result = acceleratorFromEvent(e);
      if (result.pending) return;
      if (result.error) { setFeedback({ id: recording, text: result.error, error: true }); return; }
      save(recording, result.accelerator);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  return (
    <div className="shortcut-list">
      {items.map((s) => (
        <div key={s.id} className="shortcut-row">
          <div className="shortcut-info">
            <span className="shortcut-label">{s.label}</span>
            {feedback?.id === s.id && (
              <span className={`shortcut-feedback ${feedback.error ? 'error' : ''}`}>{feedback.text}</span>
            )}
          </div>
          <button
            className={`kbd ${recording === s.id ? 'recording' : ''} ${s.accelerator && !s.registered ? 'warn' : ''}`}
            onClick={() => (recording === s.id ? stopRecording() : startRecording(s.id))}
            title={s.accelerator && !s.registered
              ? 'Não registrado: a combinação está em uso por outro app. Clique para gravar outra.'
              : 'Clique e aperte a nova combinação (Esc cancela)'}
          >
            {recording === s.id ? 'aperte as teclas…' : prettyAccelerator(s.accelerator)}
            {s.accelerator && !s.registered && recording !== s.id ? ' ⚠' : ''}
          </button>
          <div className="shortcut-actions">
            {s.accelerator && (
              <button className="mini-link" title="Desativar este atalho" onClick={() => save(s.id, '')}>off</button>
            )}
            {s.custom && (
              <button
                className="mini-link"
                title={`Voltar ao padrão (${prettyAccelerator(s.defaultAccelerator)})`}
                onClick={() => save(s.id, null)}
              >
                padrão
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
