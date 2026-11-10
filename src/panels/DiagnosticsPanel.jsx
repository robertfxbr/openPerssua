import React, { useState } from 'react';

const api = window.teka;
const MIC_TEST_MS = 2000;      // tempo ouvindo o microfone
const MIC_SILENT_LEVEL = 0.01; // pico abaixo disso = nada chegou

const CHECKS = [
  ['mic', 'microfone'],
  ['system', 'áudio do sistema'],
  ['whisper', 'transcrição'],
  ['llm', 'cérebro (IA)'],
];

// Pico de volume do microfone durante alguns segundos
async function measureMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  try {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const end = Date.now() + MIC_TEST_MS;
    while (Date.now() < end) {
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      await new Promise((r) => setTimeout(r, 100));
    }
    return { label: stream.getAudioTracks()[0]?.label || 'microfone', peak };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  }
}

async function checkSystemAudio() {
  await api.audio.enableLoopback();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } finally {
    await api.audio.disableLoopback().catch(() => {});
  }
  const ok = stream.getAudioTracks().length > 0;
  stream.getTracks().forEach((t) => t.stop());
  return ok;
}

// Verifica tudo o que a escuta precisa e diz o que fazer quando algo falha.
// Usado no último passo do onboarding e na aba "sistema".
export function DiagnosticsPanel({ sttModel, provider, disabled }) {
  const [results, setResults] = useState({}); // id -> { status, detail }
  const [running, setRunning] = useState(false);

  const set = (id, status, detail) => setResults((r) => ({ ...r, [id]: { status, detail } }));

  async function run() {
    setRunning(true);
    setResults({});
    try {
      set('mic', 'running', 'fale algo agora…');
      try {
        const { label, peak } = await measureMic();
        if (peak < MIC_SILENT_LEVEL) set('mic', 'warn', `${label}: nenhum som chegou. Fale durante o teste ou confira o mic no Windows.`);
        else set('mic', 'ok', label);
      } catch (e) {
        set('mic', 'fail', `sem acesso ao microfone (${e.name || e.message})`);
      }

      set('system', 'running', 'testando…');
      try {
        if (await checkSystemAudio()) set('system', 'ok', 'o app ouve o som que sai do PC');
        else set('system', 'warn', 'sem trilha de áudio: só o microfone será transcrito');
      } catch (e) {
        set('system', 'warn', `indisponível (${e.message || e}): só o microfone será transcrito`);
      }

      set('whisper', 'running', 'procurando…');
      try {
        const st = await api.stt.check(sttModel);
        if (!st.binary) set('whisper', 'fail', 'whisper-server não encontrado: reinstale o app');
        else if (!st.modelInstalled) set('whisper', 'warn', `modelo ${sttModel.replace(/^ggml-|\.bin$/g, '')} será baixado no primeiro uso (aba "voz")`);
        else set('whisper', 'ok', `pronto (${sttModel.replace(/^ggml-|\.bin$/g, '')})`);
      } catch (e) {
        set('whisper', 'fail', String(e.message || e));
      }

      if (!provider) {
        set('llm', 'fail', 'escolha um cérebro na lista principal');
      } else {
        set('llm', 'running', 'perguntando…');
        const r = await api.llm.test();
        if (r.ok) set('llm', 'ok', `respondeu em ${(r.ms / 1000).toFixed(1)} s`);
        else set('llm', 'fail', r.error);
      }
    } finally {
      setRunning(false);
    }
  }

  const icon = { running: '…', ok: '✓', warn: '!', fail: '✕' };

  return (
    <div className="diag">
      {CHECKS.map(([id, label]) => {
        const r = results[id];
        return (
          <div key={id} className={`diag-row ${r?.status || ''}`}>
            <span className="diag-icon">{r ? icon[r.status] : '·'}</span>
            <span className="diag-label">{label}</span>
            <span className="diag-detail">{r?.detail || ''}</span>
          </div>
        );
      })}
      <button className="chip" onClick={run} disabled={running || disabled} title={disabled ? 'Pare a escuta para testar' : ''}>
        {running ? 'testando…' : Object.keys(results).length ? 'testar de novo' : 'testar agora'}
      </button>
    </div>
  );
}
