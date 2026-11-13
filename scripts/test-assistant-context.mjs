import assert from 'node:assert/strict';
import { pdfBytes } from './fixtures/pdf.cjs';
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

for (const text of ['Curriculo de teste', '']) {
  const task = getDocument({ data: pdfBytes(text), isEvalSupported: false, useSystemFonts: true });
  try {
    const doc = await task.promise;
    if (text) assert.match(await extractPdfText(doc), /Curriculo de teste/);
    else await assert.rejects(extractPdfText(doc), /não tem texto/);
  } finally { await task.destroy(); }
}
console.log('PASS: contexto, limites, anexos de texto e PDFs com e sem texto');
