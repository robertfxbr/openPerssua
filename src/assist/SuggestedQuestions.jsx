import React, { useState } from 'react';
import { parseSuggestedQuestions } from '../assistants/model.mjs';

// A chamada é opcional: só acontece quando o usuário pede as perguntas.
export function SuggestedQuestions({ seed, onAsk, onError }) {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState(null);
  const [notice, setNotice] = useState('');
  if (!seed) return null;

  async function generate() {
    setLoading(true);
    try {
      const text = await window.teka.llm.chat({ ...seed, mode: 'questions' });
      const next = parseSuggestedQuestions(text);
      setQuestions(next);
      if (!next.length) setNotice('Não vieram perguntas válidas. Tente novamente.');
    } catch (e) { onError(`perguntas: ${e.message}`); }
    finally { setLoading(false); }
  }

  return <div className="suggested-questions">
    {(!questions?.length) && <button className="mini-link" disabled={loading} onClick={generate}>
      {loading ? 'sugerindo perguntas…' : 'sugerir perguntas'}
    </button>}
    {questions?.map((question, i) => <button className="chip" key={i} onClick={() => onAsk({ question })}>{question}</button>)}
    {notice && !questions?.length && <div className="panel-note">{notice}</div>}
  </div>;
}
