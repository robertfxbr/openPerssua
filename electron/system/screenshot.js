// Captura da tela onde o overlay está, para análise por modelo de visão.
//
// O overlay some por um instante antes da foto: sem isso a própria janela
// apareceria na captura, cobrindo justamente o que o usuário quer analisar.

const { desktopCapturer, screen } = require('electron');

const MAX_SIDE = 1920;     // modelos de visão reduzem imagens maiores de qualquer jeito
const JPEG_QUALITY = 85;   // texto continua legível com bem menos bytes que PNG
const HIDE_SETTLE_MS = 180; // tempo para o Windows remover a janela da tela

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function captureScreen(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();

  const wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible());
  if (wasVisible) {
    win.hide();
    await sleep(HIDE_SETTLE_MS);
  }

  try {
    const physical = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    };
    const thumbnailSize = fitWithin(physical.width, physical.height, MAX_SIDE);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });

    // display_id liga a fonte ao monitor; em algumas máquinas Windows ele vem
    // vazio, então cai para a ordem das telas como segunda opção.
    const index = screen.getAllDisplays().findIndex((d) => d.id === display.id);
    const source = sources.find((s) => String(s.display_id) === String(display.id))
      || sources[index]
      || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('não foi possível capturar a tela');
    }

    const jpeg = source.thumbnail.toJPEG(JPEG_QUALITY);
    const size = source.thumbnail.getSize();
    return {
      dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      width: size.width,
      height: size.height,
    };
  } finally {
    // showInactive: volta sem roubar o foco do app que o usuário está usando
    if (wasVisible && !win.isDestroyed()) win.showInactive();
  }
}

module.exports = { captureScreen };
