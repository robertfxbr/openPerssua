import React, { useEffect, useState } from 'react';
import { DiagnosticsPanel } from './DiagnosticsPanel';

const api = window.teka;

// Aba "sistema" do painel de configurações: monitor do overlay, rolagem
// automática da transcrição, logs, atualização e diagnóstico.
export function SystemPanel({
  autoScroll, onAutoScrollChange, onError, onUpdateResult, sttModel, provider, listening,
}) {
  const [displays, setDisplays] = useState([]);
  const [logStatus, setLogStatus] = useState('');
  const [updateMode, setUpdateMode] = useState('auto'); // 'auto' | 'manual'
  const [updateStatus, setUpdateStatus] = useState('');
  const [showDiag, setShowDiag] = useState(false);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    api.update.getMode?.().then((m) => m && setUpdateMode(m)).catch(() => {});
    api.update.version().then(setVersion).catch(() => setVersion(null));
  }, []);

  function changeUpdateMode(mode) {
    setUpdateMode(mode);
    api.update.setMode(mode);
  }

  async function checkNow() {
    setUpdateStatus('verificando…');
    const r = await api.update.check();
    if (!r?.ok) setUpdateStatus(`falhou: ${r?.error || 'sem resposta'}`);
    else if (r.available) {
      setUpdateStatus(r.needsInstaller
        ? `versão ${r.version} disponível; esta precisa do instalador completo`
        : `versão ${r.version} disponível`);
      onUpdateResult?.({ ...r, manual: true });
    }
    else setUpdateStatus(r.note || `você está na versão mais recente (${r.current})`);
  }

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
      <div className="theme-row">
        <span className="theme-label">instalação</span>
        <div className="mode-pills slim">
          <button
            className={`pill ${updateMode === 'auto' ? 'active' : ''}`}
            onClick={() => changeUpdateMode('auto')}
            title="Baixa a versão nova e reinicia sozinho, nunca durante a escuta"
          >
            automática
          </button>
          <button
            className={`pill ${updateMode === 'manual' ? 'active' : ''}`}
            onClick={() => changeUpdateMode('manual')}
            title="Baixa a versão nova e espera você clicar em reiniciar"
          >
            manual
          </button>
        </div>
        <button className="chip" onClick={checkNow}>verificar</button>
      </div>
      <div className="panel-note">
        O Teka procura versão nova a cada 1 h e já baixa sozinho.{' '}
        {updateMode === 'auto'
          ? 'Na automática, reinicia na versão nova quando você não estiver ouvindo nem mexendo nele.'
          : 'Na manual, avisa que está pronta e você reinicia quando quiser.'}
      </div>
      {version && (
        <div className="panel-note">
          versão {version.version}
          {version.light ? ` (atualização leve sobre o instalador ${version.shellVersion})` : ''}
        </div>
      )}
      {updateStatus && <div className="panel-note">{updateStatus}</div>}
      <div className="theme-row">
        <span className="theme-label">diagnóstico</span>
        <button className="chip" onClick={() => setShowDiag(!showDiag)}>
          {showDiag ? 'esconder' : 'testar mic, áudio, transcrição e IA'}
        </button>
      </div>
      {showDiag && <DiagnosticsPanel sttModel={sttModel} provider={provider} disabled={listening} />}
    </>
  );
}
