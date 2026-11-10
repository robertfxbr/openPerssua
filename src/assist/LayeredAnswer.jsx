import React from 'react';
import { parseLayered } from './layered';

// Resposta do modo Entrevista: a primeira linha em destaque (é o que o
// candidato começa a falar), os argumentos com a prova em cor mais fraca e o
// "se insistirem" separado no fim.
export function LayeredAnswer({ text }) {
  const { lead, points, push, extra } = parseLayered(text);
  if (!lead && !points.length) return <div className="sug-text">{text || 'pensando…'}</div>;
  return (
    <div className="layered">
      {lead && <div className="layered-lead">{lead}</div>}
      {points.length > 0 && (
        <ul className="layered-points">
          {points.map((p, i) => (
            <li key={i}>
              <span className="layered-claim">{p.claim}</span>
              {p.proof && <span className="layered-proof">: {p.proof}</span>}
            </li>
          ))}
        </ul>
      )}
      {extra.map((line, i) => <div key={i} className="layered-extra">{line}</div>)}
      {push && (
        <div className="layered-push">
          <span className="layered-push-label">se insistirem</span> {push}
        </div>
      )}
    </div>
  );
}
