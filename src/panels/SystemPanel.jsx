import React, { useEffect, useState } from 'react';

const api = window.openperssua;

// Aba "sistema" do painel de configurações: monitor do overlay, rolagem
// automática da transcrição e logs de debug.
export function SystemPanel({ autoScroll, onAutoScrollChange, onError }) {
  const [displays, setDisplays] = useState([]);
  const [logStatus, setLogStatus] = useState('');

  function refreshDisplays() {
    api.overlay.listDisplays().then(setDisplays).catch(() => setDisplays([]));
  }

  useEffect(() => { refreshDisplays(); }, []);

  async function moveTo(id) {
    const r = await api.overlay.moveToDisplay(id);
    if (!r?.ok) onError?.(`monitor: ${r?.error || 'falha ao mover'}`);
    refreshDisplays();
  }

  async function copyLogs() {
    const r = await api.logs.copyRecent();
    setLogStatus(r?.ok ? 'logs copiados' : (r?.error || 'falha ao copiar'));
    setTimeout(() => setLogStatus(''), 2500);
  }

  async function openLogs() {
    const r = await api.logs.openFolder();
    if (!r?.ok) setLogStatus(r?.error || 'falha ao abrir a pasta');
  }

  return (
    <>
      {displays.length > 1 && (
        <div className="theme-row">
          <span className="theme-label">monitor</span>
          <div className="mode-pills slim">
            {displays.map((d) => (
              <button
                key={d.id}
                className={`pill ${d.current ? 'active' : ''}`}
                title={`${d.width}×${d.height}${d.primary ? ' · principal' : ''}`}
                onClick={() => moveTo(d.id)}
              >
                {d.label.replace('Monitor ', '')}{d.primary ? '★' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="theme-row">
        <span className="theme-label">rolagem</span>
        <div className="mode-pills slim">
          <button
            className={`pill ${autoScroll ? 'active' : ''}`}
            onClick={() => onAutoScrollChange(true)}
            title="Acompanha a fala mais recente, a menos que você role para cima"
          >
            automática
          </button>
          <button
            className={`pill ${!autoScroll ? 'active' : ''}`}
            onClick={() => onAutoScrollChange(false)}
            title="A transcrição fica parada onde você deixou"
          >
            manual
          </button>
        </div>
      </div>
      <div className="theme-row">
        <span className="theme-label">logs</span>
        <button className="chip" onClick={copyLogs} title="Copia o trecho mais recente para colar numa issue">copiar</button>
        <button className="chip" onClick={openLogs}>abrir pasta</button>
        {logStatus && <span className="inline-status">{logStatus}</span>}
      </div>
    </>
  );
}
