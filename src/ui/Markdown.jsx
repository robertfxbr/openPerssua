import React from 'react';

// Markdown mínimo para as respostas da IA: parágrafos, listas, citação,
// títulos, bloco de código, **negrito**, *itálico* e `código`. Gera elementos
// React (nunca HTML cru), então nada do texto do modelo vira marcação ativa.
// Durante o streaming o texto chega pela metade; um ** sem par fica como texto.

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = '' }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // bloco de código ```...``` (fecha no fim se o streaming ainda não fechou)
    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={blocks.length}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push(<p key={blocks.length} className="md-h">{inline(heading[1], blocks.length)}</p>);
      i++;
      continue;
    }
    // listas: itens seguidos de "- ", "* ", "• " ou "1. "
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && bullet.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(bullet, ''), `${blocks.length}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={blocks.length}>{inline(quote.join('\n'), blocks.length)}</blockquote>);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !bullet.test(lines[i]) && !/^\s*(>|```|#{1,6}\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={blocks.length}>{inline(para.join('\n'), blocks.length)}</p>);
  }
  return <div className={`md ${className}`}>{blocks}</div>;
}
