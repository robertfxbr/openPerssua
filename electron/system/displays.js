// Multi-monitor: lista as telas e move o overlay entre elas mantendo a
// posição relativa (se estava no canto superior direito, continua lá).

const { screen } = require('electron');

function listDisplays(win) {
  const primaryId = screen.getPrimaryDisplay().id;
  const currentId = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).id : null;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `Monitor ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId,
    current: d.id === currentId,
  }));
}

// Converte a posição da janela em fração da área útil da tela atual e aplica
// a mesma fração na tela de destino. Depois limita para caber inteira.
function moveToDisplay(win, displayId) {
  if (!win || win.isDestroyed()) return { ok: false, error: 'janela indisponível' };
  const target = screen.getAllDisplays().find((d) => d.id === Number(displayId));
  if (!target) return { ok: false, error: 'monitor não encontrado' };

  const bounds = win.getBounds();
  const from = screen.getDisplayMatching(bounds).workArea;
  const to = target.workArea;

  const fracX = from.width > bounds.width ? (bounds.x - from.x) / (from.width - bounds.width) : 0;
  const fracY = from.height > bounds.height ? (bounds.y - from.y) / (from.height - bounds.height) : 0;

  const width = Math.min(bounds.width, to.width);
  const height = Math.min(bounds.height, to.height);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const x = Math.round(to.x + clamp(fracX, 0, 1) * (to.width - width));
  const y = Math.round(to.y + clamp(fracY, 0, 1) * (to.height - height));

  win.setBounds({ x, y, width, height });
  return { ok: true };
}

function moveToNextDisplay(win) {
  if (!win || win.isDestroyed()) return { ok: false, error: 'janela indisponível' };
  const all = screen.getAllDisplays();
  if (all.length < 2) return { ok: false, error: 'só há um monitor' };
  const currentId = screen.getDisplayMatching(win.getBounds()).id;
  const idx = all.findIndex((d) => d.id === currentId);
  return moveToDisplay(win, all[(idx + 1) % all.length].id);
}

module.exports = { listDisplays, moveToDisplay, moveToNextDisplay };
