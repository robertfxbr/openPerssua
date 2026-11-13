import React, { useEffect, useRef, useState } from 'react';
import { normalizeContext, contextSize, appendContextFile, MAX_CONTEXT_CHARS } from '../assistants/context.mjs';
import { extractAttachment, ATTACH_ACCEPT } from '../assistants/extract.mjs';

export function AssistantContextEditor({ value, onChange }) {
  const context = normalizeContext(value);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filesSize = context.files.reduce((n, f) => n + f.text.length, 0);

  async function attach(event) {
    const files = [...event.target.files];
    event.target.value = '';
    setLoading(true);
    const notices = [];
    let next = context;
    for (const file of files) {
      try {
        const text = await extractAttachment(file);
        if (!mounted.current) return;
        if (!text.trim()) throw new Error('Arquivo sem texto.');
        const result = appendContextFile(next, { name: file.name, text });
        next = result.context;
        if (result.truncated) notices.push(`${file.name}: texto cortado para caber no limite.`);
      } catch (e) { notices.push(`${file.name}: ${e.message}`); }
      if (!mounted.current) return;
    }
    if (!mounted.current) return;
    onChange(next);
    setNotice(notices.join(' '));
    setLoading(false);
  }

  return (
    <div className="assistant-context">
      <label>Contexto deste assistente
        <textarea className="profile-editor" rows={4} value={context.text} disabled={loading}
          placeholder="Informações para consultar: experiência, vaga, material de estudo…"
          onChange={(e) => {
            const room = MAX_CONTEXT_CHARS - filesSize;
            setNotice(e.target.value.length > room ? 'Texto cortado para caber no limite de 20.000 caracteres.' : '');
            onChange({ ...context, text: e.target.value.slice(0, room) });
          }} />
      </label>
      <div className="panel-note">{contextSize(context).toLocaleString('pt-BR')} / 20.000 caracteres · salvo automaticamente</div>
      {context.files.map((f, i) => (
        <div className="context-file" key={i}>
          <span>{f.name} · {f.text.length.toLocaleString('pt-BR')} caracteres</span>
          <button className="mini-link danger" disabled={loading} title={`Remover ${f.name}`}
            onClick={() => onChange({ ...context, files: context.files.filter((_, index) => index !== i) })}>✕</button>
        </div>
      ))}
      <label className="chip attach-label">{loading ? 'extraindo…' : '+ anexar texto ou PDF'}
        <input type="file" accept={ATTACH_ACCEPT} multiple disabled={loading} onChange={attach} />
      </label>
      <div className="panel-note">Só o texto fica salvo. PDF escaneado não é reconhecido.</div>
      {notice && <div className="panel-note" role="status">{notice}</div>}
    </div>
  );
}
