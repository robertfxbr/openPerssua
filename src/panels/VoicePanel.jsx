import React, { useEffect, useState } from 'react';

const api = window.teka;

function formatMB(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

// Aba "voz": modelos do Whisper (baixar, usar, apagar), idioma, vocabulário
// e o tratamento do microfone (eco e ruído).
export function VoicePanel({
  longListenReminder, onLongListenReminderChange,
  sttModel, onSelectModel, sttLang, onLang, sttPrompt, onPrompt,
  echoFilter, onEchoFilter, noiseSuppression, onNoise, sttFast, onSttFast, listening, onError,
}) {
  const [models, setModels] = useState([]);
  const [armed, setArmed] = useState(null); // modelo aguardando 2º clique para apagar

  function refresh() {
    api.stt.listModels().then(setModels).catch(() => {});
  }

  useEffect(() => {
    refresh();
    const unsub = api.stt.onModelProgress((p) => {
      if (!p?.name) return;
      setModels((list) => list.map((m) => (m.name === p.name ? { ...m, downloading: true, progress: p } : m)));
    });
    return unsub;
  }, []);

  async function download(name) {
    setModels((list) => list.map((m) => (m.name === name ? { ...m, downloading: true } : m)));
    const r = await api.stt.downloadModel(name);
    if (!r?.ok && r?.error !== 'download cancelado') onError?.(`modelo: ${r?.error || 'falha no download'}`);
    refresh();
  }

  async function remove(name) {
    if (armed !== name) {
      setArmed(name);
      setTimeout(() => setArmed((cur) => (cur === name ? null : cur)), 3000);
      return;
    }
    setArmed(null);
    const r = await api.stt.deleteModel(name);
    if (!r?.ok) onError?.(`modelo: ${r?.error || 'não foi possível apagar'}`);
    refresh();
  }

  return (
    <>
      <label className="option-label"><input type="checkbox" checked={longListenReminder} onChange={(e) => onLongListenReminderChange(e.target.checked)} /> Lembrete de escuta longa</label>
      <div className="panel-note">Após 30 minutos, pede para continuar. Sem resposta em 60 segundos, pausa e mantém as falas salvas.</div>
      <div className="panel-section">modelo de transcrição (roda no seu PC)</div>
      <div className="model-list">
        {models.map((m) => {
          const pct = m.progress?.total ? Math.round((m.progress.received / m.progress.total) * 100) : null;
          const active = sttModel === m.name;
          return (
            <div key={m.name} className={`model-row ${active ? 'active' : ''}`}>
              <div className="model-info">
                <span className="assistant-name">{active ? '● ' : ''}{m.label}</span>
                <span className="history-meta">
                  {m.installed ? formatMB(m.bytes) : `~${formatMB(m.approxMB * 1024 * 1024)}`} · {m.note}
                </span>
                {m.downloading && (
                  <div className="level-track"><div className="level-fill mic" style={{ width: `${pct ?? 2}%` }} /></div>
                )}
              </div>
              {m.downloading ? (
                <>
                  <span className="inline-status">{pct !== null ? `${pct}%` : '…'}</span>
                  <button className="mini-link" onClick={() => api.stt.cancelDownload(m.name).then(refresh)}>cancelar</button>
                </>
              ) : m.installed ? (
                <>
                  <button
                    className="mini-link"
                    disabled={active}
                    title={listening ? 'Vale a partir da próxima escuta' : ''}
                    onClick={() => onSelectModel(m.name)}
                  >
                    {active ? 'em uso' : 'usar'}
                  </button>
                  <button
                    className={`mini-link danger ${armed === m.name ? 'armed' : ''}`}
                    title="Apagar do disco"
                    onClick={() => remove(m.name)}
                  >
                    {armed === m.name ? 'apagar?' : '🗑'}
                  </button>
                </>
              ) : (
                <button className="mini-link" onClick={() => download(m.name)}>baixar</button>
              )}
            </div>
          );
        })}
      </div>
      {listening && <div className="panel-note">A troca de modelo vale a partir da próxima escuta.</div>}

      <div className="theme-row">
        <span className="theme-label">idioma</span>
        <div className="mode-pills slim">
          <button className={`pill ${sttLang === 'pt' ? 'active' : ''}`} onClick={() => onLang('pt')} title="Transcrição em português (Brasil)">PT-BR</button>
          <button className={`pill ${sttLang === 'en' ? 'active' : ''}`} onClick={() => onLang('en')} title="Transcription in English (US)">EN-US</button>
          <button className={`pill ${sttLang === 'pten' ? 'active' : ''}`} onClick={() => onLang('pten')} title="Detecta português ou inglês em cada fala. Bom para entrevista em inglês ou conversa misturada. Baixa o modelo Tiny (75 MB) só para detectar o idioma; cada fala leva uns 0,4 s a mais">PT+EN</button>
        </div>
      </div>
      <div className="theme-row">
        <span className="theme-label">vocabulário</span>
        <input
          className="model-input"
          value={sttPrompt}
          placeholder="nomes próprios e jargões (ex.: Robert, Teka)"
          title="O Whisper usa como contexto; soma-se ao vocabulário embutido (nomes IBGE + termos de reunião e tecnologia PT-BR/EN)"
          onChange={(e) => onPrompt(e.target.value)}
        />
      </div>

      <div className="panel-section">microfone</div>
      <div className="theme-row">
        <span className="theme-label">eco</span>
        <div className="mode-pills slim">
          <button
            className={`pill ${echoFilter ? 'active' : ''}`}
            onClick={() => onEchoFilter(true)}
            title="Sem fone, o mic capta a voz dos outros pela caixa de som. Esta opção tira da transcrição as falas repetidas."
          >
            remover
          </button>
          <button
            className={`pill ${!echoFilter ? 'active' : ''}`}
            onClick={() => onEchoFilter(false)}
            title="Use com fone de ouvido"
          >
            manter
          </button>
        </div>
      </div>
      <div className="theme-row">
        <span className="theme-label">ruído</span>
        <div className="mode-pills slim">
          <button className={`pill ${noiseSuppression ? 'active' : ''}`} onClick={() => onNoise(true)} title="Filtra ventilador, teclado e barulho de fundo">filtrar</button>
          <button className={`pill ${!noiseSuppression ? 'active' : ''}`} onClick={() => onNoise(false)}>desligado</button>
        </div>
      </div>
      <div className="theme-row">
        <span className="theme-label">velocidade</span>
        <div className="mode-pills slim">
          <button className={`pill ${!sttFast ? 'active' : ''}`} onClick={() => onSttFast(false)} title="Mais preciso">precisa</button>
          <button
            className={`pill ${sttFast ? 'active' : ''}`}
            onClick={() => onSttFast(true)}
            title="Falas de até 10 s saem cerca de 30% mais rápido, com um pouco mais de erro em áudio difícil. Falas mais longas usam o modo preciso"
          >
            rápida
          </button>
        </div>
      </div>
      {listening && <div className="panel-note">Eco vale na hora; ruído e velocidade valem a partir da próxima escuta.</div>}
    </>
  );
}
