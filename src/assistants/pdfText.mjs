import { MAX_CONTEXT_CHARS } from './context.mjs';

// Recebe o documento já aberto para funcionar no navegador e nos testes locais.
export async function extractPdfText(pdf) {
  if (pdf.numPages > 500) throw new Error('PDF longo demais (máximo de 500 páginas).');
  let result = '';
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    result += content.items.map((item) => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') + '\n';
    page.cleanup();
    if (result.length > MAX_CONTEXT_CHARS) break;
  }
  if (!result.trim()) throw new Error('Este PDF não tem texto para extrair. PDFs escaneados precisam de reconhecimento de texto.');
  return result.slice(0, MAX_CONTEXT_CHARS + 1);
}
