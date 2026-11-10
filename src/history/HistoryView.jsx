import React, { useEffect, useState } from 'react';
import { formatDuration } from '../util/time';

const api = window.openperssua;
const PAGE_SIZE = 50;
const DEFAULT_SUBJECT = 'Sessão overlay';

// plural(1, 'fala') -> "1 fala"; plural(3, 'fala') -> "3 falas"
function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function sessionDuration(s) {
  return s.ended_at ? s.ended_at - s.started_at : 0;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// Markdown da sessão para colar em notas (Obsidian, Notion, e-mail)
function sessionToMarkdown({ session, transcriptions, messages }) {
  const dt = new Date(session.started_at).toLocaleString('pt-BR');
  const title = session.subject || DEFAULT_SUBJECT;
  const lines = [`# ${title} — ${dt}`, ''];
  const duration = formatDuration(sessionDuration(session));
  if (duration) lines.push(`Duração: ${duration}`, '');
  if (transcriptions.length) {
    lines.push('## Transcrição', '');
    for (const t of transcriptions) {
      lines.push(`**${t.source === 'mic' ? 'Você' : 'Reunião'}:** ${t.text}`, '');
    }
  }
  const summaries = messages.filter((m) => m.content?.startsWith('[RESUMO'));
  const answers = messages.filter((m) => !m.content?.startsWith('[RESUMO'));
  if (summaries.length) {
    lines.push('## Resumo', '');
    for (const m of summaries) lines.push(m.content.replace('[RESUMO DA SESSÃO]\n', ''), '');
  }
  if (answers.length) {
    lines.push('## Respostas do copiloto', '');
    for (const m of answers) lines.push(m.content, '');
  }
  return lines.join('\n');
}

// Tela de histórico: lista, renomear, excluir, limpar tudo, ver detalhes,
// exportar em Markdown e retomar uma sessão antiga.
export function HistoryView({ onBack, onResume, onError, copyText, listening, activeSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState(null);
  const [detail, setDetail] = useState(null);         // { session, transcriptions, messages }
  const [editing, setEditing] = useState(null);       // { id, value }
  const [confirmDelete, setConfirmDelete] = useState(null); // id aguardando 2º clique
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(offset = 0) {
    try {
      const page = await api.db.getSessions({ offset, limit: PAGE_SIZE });
      setSessions((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
      setStats(await api.db.getStats());
    } catch (e) {
      onError(`histórico: ${e.message || e}`);
    }
  }

  useEffect(() => { load(0); }, []);

  async function openDetail(session) {
    try {
      const [transcriptions, messages] = await Promise.all([
        api.db.getTranscriptions(session.id),
        api.db.getMessages(session.id),
      ]);
      setDetail({ session, transcriptions, messages });
    } catch (e) {
      onError(`histórico: ${e.message || e}`);
    }
  }

  async function saveSubject(id, value) {
    setEditing(null);
    await api.db.updateSubject(id, value);
    const subject = value.trim() || null;
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, subject } : s)));
    setDetail((d) => (d?.session.id === id ? { ...d, session: { ...d.session, subject } } : d));
  }

  // Exclusão em dois cliques: o primeiro arma, o segundo confirma.
  async function removeSession(id) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setConfirmDelete(null);
    const r = await api.db.deleteSession(id);
    if (!r?.ok) { onError('não foi possível excluir a sessão'); return; }
    setSessions((list) => list.filter((s) => s.id !== id));
    if (detail?.session.id === id) setDetail(null);
    api.db.getStats().then(setStats).catch(() => {});
  }

  async function clearAll() {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    await api.db.clearAll();
    setSessions([]);
    setHasMore(false);
    setDetail(null);
    api.db.getStats().then(setStats).catch(() => {});
  }

  async function exportMarkdown() {
    if (!detail) return;
    await copyText(sessionToMarkdown(detail));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Campo de título editável (Enter salva, Esc cancela)
  const titleEditor = (s) => (
    <input
      className="title-input"
      autoFocus
      value={editing.value}
      maxLength={120}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') saveSubject(s.id, editing.value);
        if (e.key === 'Escape') setEditing(null);
      }}
      onBlur={() => saveSubject(s.id, editing.value)}
    />
  );

  const deleteButton = (id) => (
    <button
      className={`mini-link danger ${confirmDelete === id ? 'armed' : ''}`}
      title="Excluir sessão"
      onClick={(e) => { e.stopPropagation(); removeSession(id); }}
      disabled={id === activeSessionId}
    >
      {confirmDelete === id ? 'confirmar?' : '🗑'}
    </button>
  );

  return (
    <div className="app">
      <div className="header">
        <button className="icon-btn" title="Voltar" onClick={() => (detail ? setDetail(null) : onBack())}>←</button>
        <div className="logo">
          <span className="logo-name">{detail ? 'Sessão' : 'Histórico'}</span>
        </div>
        {detail && (
          <button className="icon-btn" title="Copiar como Markdown" onClick={exportMarkdown}>
            {copied ? '✓' : '⧉'}
          </button>
        )}
        <button className="icon-btn" title="Esconder" onClick={() => api.overlay.toggle()}>—</button>
      </div>

      {!detail ? (
        <>
          {stats && stats.sessions > 0 && (
            <div className="history-stats">
              {plural(stats.sessions, 'sessão', 'sessões')}
              {stats.totalMs > 0 && ` · ${formatDuration(stats.totalMs)} gravados`}
              {` · ${plural(stats.messages, 'resposta')}`}
            </div>
          )}
          <div className="history-list">
            {sessions.length === 0 && (
              <div className="transcript-empty">
                <span className="big">🕘</span>
                Nenhuma sessão gravada ainda.
                <br />Inicie uma escuta e ela aparecerá aqui.
              </div>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className="history-item"
                role="button"
                tabIndex={0}
                onClick={() => editing?.id !== s.id && openDetail(s)}
                onKeyDown={(e) => e.key === 'Enter' && editing?.id !== s.id && openDetail(s)}
              >
                <span className="history-date">{formatDate(s.started_at)}</span>
                <div className="history-main">
                  {editing?.id === s.id
                    ? titleEditor(s)
                    : <span className="history-subject">{s.subject || DEFAULT_SUBJECT}</span>}
                  <span className="history-meta">
                    {s.id === activeSessionId ? 'em andamento · ' : ''}
                    {formatDuration(sessionDuration(s)) || (s.status === 'active' ? '' : '—')}
                    {` · ${plural(s.transcription_count ?? 0, 'fala')} · ${plural(s.message_count ?? 0, 'resposta')}`}
                  </span>
                </div>
                <div className="history-actions">
                  <button
                    className="mini-link"
                    title="Renomear"
                    onClick={(e) => { e.stopPropagation(); setEditing({ id: s.id, value: s.subject || '' }); }}
                  >
                    ✎
                  </button>
                  {deleteButton(s.id)}
                </div>
              </div>
            ))}
            {hasMore && (
              <button className="chip history-more" onClick={() => load(sessions.length)}>carregar mais</button>
            )}
          </div>
          {sessions.length > 0 && (
            <div className="history-footer">
              <button className={`mini-link danger ${confirmClear ? 'armed' : ''}`} onClick={clearAll} disabled={listening}>
                {confirmClear ? 'apagar TODAS as sessões? clique de novo' : 'limpar todo o histórico'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="detail-head">
            {editing?.id === detail.session.id
              ? titleEditor(detail.session)
              : (
                <button
                  className="detail-title"
                  title="Clique para renomear"
                  onClick={() => setEditing({ id: detail.session.id, value: detail.session.subject || '' })}
                >
                  {detail.session.subject || DEFAULT_SUBJECT} <span className="pencil">✎</span>
                </button>
              )}
            <span className="history-meta">
              {formatDate(detail.session.started_at)}
              {formatDuration(sessionDuration(detail.session)) && ` · ${formatDuration(sessionDuration(detail.session))}`}
            </span>
            <div className="detail-actions">
              <button
                className="chip"
                onClick={() => onResume(detail.session, detail.transcriptions)}
                disabled={listening}
                title={listening ? 'Pare a escuta atual antes de retomar outra sessão' : 'Volta a ouvir e adiciona as falas novas nesta sessão'}
              >
                ▶ continuar sessão
              </button>
              {deleteButton(detail.session.id)}
            </div>
          </div>
          <div className="transcript">
            {detail.transcriptions.length === 0 && detail.messages.length === 0 && (
              <div className="transcript-empty">Sessão sem falas registradas.</div>
            )}
            {detail.transcriptions.map((t) => (
              <div key={`t${t.id}`} className={`bubble ${t.source}`}>
                <span className="who">{t.source === 'mic' ? 'Você' : 'Reunião'}</span>
                {t.text}
              </div>
            ))}
            {detail.messages.map((m) => (
              <div key={`m${m.id}`} className="answer">
                <span className="label">✦ copiloto</span>
                {m.content}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
