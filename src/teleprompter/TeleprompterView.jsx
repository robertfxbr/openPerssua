import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, Pause, RotateCcw, Ghost, ClipboardPaste, Minus, Plus } from 'lucide-react';

const api = window.teka;

// Velocidade em pixels por segundo e tamanho da letra em px
const SPEED = { min: 10, max: 200, step: 10, initial: 50 };
const FONT = { min: 18, max: 56, step: 2, initial: 30 };
const COUNTDOWN_S = 3;

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));

// Teleprompter: lê um texto do "meu contexto" (ou colado) rolando sozinho,
// com uma faixa na altura dos olhos. Ao abrir, liga o modo fantasma (a
// janela some da gravação e do compartilhamento) e, ao sair, devolve o modo
// fantasma como estava.
//
// sources: [{ id, label, text }]
export function TeleprompterView({ sources, ghost, onGhost, onBack, notice }) {
  const [pasted, setPasted] = useState(null);
  const all = pasted ? [...sources, pasted] : sources;
  const [sourceId, setSourceId] = useState(sources[0]?.id || null);
  const source = all.find((s) => s.id === sourceId) || all[0] || null;

  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [speed, setSpeed] = useState(SPEED.initial);
  const [font, setFont] = useState(FONT.initial);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Velocidade e letra ficam salvas para a próxima gravação
  const prefsLoaded = useRef(false);
  useEffect(() => {
    api.settings.get('teleprompter.prefs').then((p) => {
      if (p && typeof p === 'object') {
        if (Number.isFinite(p.speed)) setSpeed(clamp(p.speed, SPEED));
        if (Number.isFinite(p.font)) setFont(clamp(p.font, FONT));
      }
    }).catch(() => {}).finally(() => { prefsLoaded.current = true; });
  }, []);
  useEffect(() => {
    if (prefsLoaded.current) api.settings.set('teleprompter.prefs', { speed, font }).catch(() => {});
  }, [speed, font]);

  // Modo fantasma: liga ao abrir; ao sair, desliga só se foi o teleprompter
  // que ligou (se já estava ligado antes, continua ligado).
  const ghostRef = useRef(ghost);
  useEffect(() => { ghostRef.current = ghost; }, [ghost]);
  useEffect(() => {
    const turnedOn = !ghostRef.current.hidden;
    if (turnedOn) onGhost(true);
    return () => { if (turnedOn && ghostRef.current.hidden) onGhost(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rolagem: acumula a fração de pixel entre quadros para andar liso mesmo
  // em velocidade baixa. Para sozinho no fim do texto.
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const step = (now) => {
      const el = scrollRef.current;
      if (!el) return;
      carry += ((now - last) / 1000) * speedRef.current;
      last = now;
      if (carry >= 1) {
        const px = Math.floor(carry);
        el.scrollTop += px;
        carry -= px;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setPlaying(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Contagem 3, 2, 1 antes de começar do topo: dá tempo de olhar para a câmera
  useEffect(() => {
    if (!countdown) return undefined;
    const t = setTimeout(() => {
      if (countdown === 1) { setCountdown(0); setPlaying(true); } else setCountdown(countdown - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  function togglePlay() {
    if (!source) return;
    if (countdown) { setCountdown(0); return; }
    if (playing) { setPlaying(false); return; }
    const el = scrollRef.current;
    const atTop = !el || el.scrollTop < 2;
    const atEnd = el && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if (atEnd) el.scrollTop = 0;
    if (atTop || atEnd) setCountdown(COUNTDOWN_S); else setPlaying(true);
  }

  function restart() {
    setPlaying(false);
    setCountdown(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }

  function changeSource(id) {
    restart();
    setSourceId(id);
  }

  async function pasteText() {
    setError('');
    try {
      const text = String(await api.clipboard.readText() || '').trim();
      if (!text) { setError('a área de transferência está vazia'); return; }
      setPasted({ id: 'clipboard', label: 'texto colado', text });
      changeSource('clipboard');
    } catch (e) {
      setError(`não foi possível colar: ${e?.message || e}`);
    }
  }

  // Teclado (com a janela do Teka em foco): espaço começa/pausa, setas mudam
  // a velocidade, + e - mudam a letra, Home volta ao início, Esc sai.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('select, input, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed((v) => clamp(v + SPEED.step, SPEED)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed((v) => clamp(v - SPEED.step, SPEED)); }
      else if (e.key === '+' || e.key === '=') setFont((v) => clamp(v + FONT.step, FONT));
      else if (e.key === '-') setFont((v) => clamp(v - FONT.step, FONT));
      else if (e.key === 'Home') restart();
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const running = playing || countdown > 0;

  return (
    <div className={`app prompter-view ${running ? 'running' : ''}`}>
      <div className="prompter-bar">
        <button className="icon-btn" title="Voltar (Esc)" onClick={onBack}><ArrowLeft size={16} /></button>
        <span className="prompter-title">teleprompter</span>
        {all.length > 0 && (
          <select className="model-input prompter-source" value={source?.id || ''} onChange={(e) => changeSource(e.target.value)} title="Texto a ler">
            {all.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <button className="icon-btn" title="Usar o texto copiado (área de transferência)" onClick={pasteText}><ClipboardPaste size={15} /></button>
        <button
          className={`prompter-ghost ${ghost.hidden ? 'on' : 'off'}`}
          title={ghost.hidden ? 'A janela não aparece na gravação nem no compartilhamento de tela' : 'Atenção: a janela aparece na gravação'}
          onClick={() => onGhost(!ghost.hidden)}
        >
          <Ghost size={13} /> {ghost.hidden ? 'fora da gravação' : 'aparece na gravação'}
        </button>
      </div>
      {notice}
      {error && <div className="error-banner">{error}</div>}

      {source ? (
        <div className="prompter-stage" onClick={togglePlay}>
          <div className="prompter-scroll" ref={scrollRef} style={{ fontSize: `${font}px` }}>
            <div className="prompter-pad-top" />
            <div className="prompter-text">{source.text}</div>
            <div className="prompter-pad-bottom" />
          </div>
          {/* faixa da altura de uma linha, onde a primeira linha começa */}
          <div className="prompter-guide" style={{ height: `${Math.round(font * 1.42) + 12}px` }} />
          {countdown > 0 && <div className="prompter-countdown">{countdown}</div>}
        </div>
      ) : (
        <div className="prompter-empty">
          <b>Nenhum texto para ler.</b>
          <span>Anexe o roteiro em <b>meu contexto</b> (texto, .txt, .md ou PDF) na tela principal, ou copie o texto e toque em colar.</span>
          <button className="chip" onClick={pasteText}><ClipboardPaste size={13} /> colar o texto copiado</button>
        </div>
      )}

      <div className="prompter-controls">
        <button className="icon-btn" title="Voltar ao início (Home)" onClick={restart} disabled={!source}><RotateCcw size={15} /></button>
        <button className="prompter-play" title={running ? 'Pausar (espaço)' : 'Começar (espaço)'} onClick={togglePlay} disabled={!source}>
          {running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <div className="prompter-stepper" title="Velocidade (setas ↑ ↓)">
          <span className="theme-label">velocidade</span>
          <button className="icon-btn" onClick={() => setSpeed((v) => clamp(v - SPEED.step, SPEED))}><Minus size={13} /></button>
          <span className="prompter-value">{speed}</span>
          <button className="icon-btn" onClick={() => setSpeed((v) => clamp(v + SPEED.step, SPEED))}><Plus size={13} /></button>
        </div>
        <div className="prompter-stepper" title="Tamanho da letra (+ e -)">
          <span className="theme-label">letra</span>
          <button className="icon-btn" onClick={() => setFont((v) => clamp(v - FONT.step, FONT))}><Minus size={13} /></button>
          <span className="prompter-value">{font}</span>
          <button className="icon-btn" onClick={() => setFont((v) => clamp(v + FONT.step, FONT))}><Plus size={13} /></button>
        </div>
      </div>
    </div>
  );
}
