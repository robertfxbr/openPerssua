import { MAX_CONTEXT_CHARS } from './context.mjs';
import { extractPdfText } from './pdfText.mjs';

export const TEXT_EXTENSIONS = 'txt,md,markdown,json,csv,tsv,js,jsx,ts,tsx,py,java,cs,sql,html,htm,css,scss,xml,yaml,yml,toml,ini,log,c,cpp,h,hpp,go,rs,rb,php,sh,ps1,r,kt,swift,vue,svelte';
export const ATTACH_ACCEPT = '.pdf,' + TEXT_EXTENSIONS.split(',').map((e) => `.${e}`).join(',');

// Limita memória e tempo de extração; não renderiza nem executa o documento.
export async function extractAttachment(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo de 20 MB).');
  if (extension !== 'pdf') {
    if (!TEXT_EXTENSIONS.split(',').includes(extension)) throw new Error('Escolha um arquivo de texto, código ou PDF.');
    const text = await file.text();
    if (text.includes('\0')) throw new Error('Este arquivo não parece conter texto.');
    return text.slice(0, MAX_CONTEXT_CHARS + 1);
  }
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  try {
    const pdf = await task.promise;
    return await extractPdfText(pdf);
  } finally {
    await task.destroy();
  }
}
