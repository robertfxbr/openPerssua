import React, { useEffect, useState } from 'react';

// Fora das telas internas para a confirmação continuar visível no histórico.
export function McpConfirmations() {
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const offRequest = window.teka.mcp.onConfirmation(request => setPending(items => [...items, request]));
    const offClosed = window.teka.mcp.onConfirmationClosed(({ id }) => setPending(items => items.filter(item => item.id !== id)));
    return () => { offRequest(); offClosed(); };
  }, []);
  if (!pending.length) return null;
  const request = pending[0];
  const reply = allowed => window.teka.mcp.confirm(request.id, allowed).catch(e => setError(e.message));
  return <div className="mcp-confirm" role="dialog" aria-label="Permitir ferramenta" aria-modal="true">
    <strong>Permitir esta consulta?</strong>
    <div>{request.server} · {request.tool}</div>
    <pre>{JSON.stringify(request.arguments, null, 2)}</pre>
    <div className="panel-note">Sem resposta em até 45 segundos, a consulta é negada.{pending.length > 1 ? ` Mais ${pending.length - 1} aguardando.` : ''}</div>
    <div className="assistant-filters"><button className="chip" onClick={() => reply(false)}>negar</button><button className="chip active" onClick={() => reply(true)}>permitir</button></div>
    {error && <div role="alert">{error}</div>}
  </div>;
}
