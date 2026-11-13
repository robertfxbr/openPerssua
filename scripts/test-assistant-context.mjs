import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeContext, contextSize, appendContextFile, contextToText } from '../src/assistants/context.mjs';
import { extractPdfText } from '../src/assistants/pdfText.mjs';
import { extractAttachment } from '../src/assistants/extract.mjs';

assert.deepEqual(normalizeContext(null), { text: '', files: [] });
const result = appendContextFile({ text: 'a'.repeat(19990) }, { name: 'cv.txt', text: 'b'.repeat(100) });
assert.equal(contextSize(result.context), 20000);
assert.equal(result.truncated, true);
assert.equal(result.context.files[0].text.length, 10);
assert.throws(() => appendContextFile(result.context, { name: 'a', text: 'b' }), /cheio/);
assert.match(contextToText(result.context), /Arquivo: cv.txt/);
assert.equal(await extractAttachment(new File(['const a = 1;'], 'teste.js')), 'const a = 1;');
await assert.rejects(extractAttachment(new File(['\0'], 'bin.txt')), /não parece/);

// PDF mínimo criado aqui, sem dados pessoais nem arquivos externos.
function pdfBytes(content) {
  const stream = `BT /F1 12 Tf 10 10 Td (${content}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(text);
}
for (const text of ['Curriculo de teste', '']) {
  const task = getDocument({ data: pdfBytes(text), isEvalSupported: false, useSystemFonts: true });
  try {
    const doc = await task.promise;
    if (text) assert.match(await extractPdfText(doc), /Curriculo de teste/);
    else await assert.rejects(extractPdfText(doc), /não tem texto/);
  } finally { await task.destroy(); }
}
console.log('PASS: contexto, limites, anexos de texto e PDFs com e sem texto');
