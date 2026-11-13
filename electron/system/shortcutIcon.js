// Ícone dos atalhos do Windows (menu Iniciar e área de trabalho).
//
// Quem instalou a casca 0.4.0 tem o Teka.exe com o ícone padrão do
// Electron, e a atualização leve não troca o .exe. Então o app copia o
// ícone novo para a pasta de dados (o Windows não lê ícone de dentro do
// .asar) e aponta para ele os atalhos que abrem ESTE Teka.exe.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const log = require('electron-log');

const ICON_NAME = 'teka-icon.ico';

function shortcutPaths() {
  const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return [
    path.join(startMenu, 'Teka.lnk'),
    path.join(startMenu, 'Teka', 'Teka.lnk'),
    path.join(app.getPath('desktop'), 'Teka.lnk'),
  ];
}

// Só grava o .ico de novo quando o conteúdo mudou
function ensureIconFile() {
  const src = path.join(__dirname, '..', 'assets', 'icon.ico');
  const dest = path.join(app.getPath('userData'), ICON_NAME);
  const data = fs.readFileSync(src);
  let current = null;
  try { current = fs.readFileSync(dest); } catch { /* ainda não existe */ }
  if (!current || !current.equals(data)) fs.writeFileSync(dest, data);
  return dest;
}

function samePath(a, b) {
  return path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();
}

function updateShortcutIcons() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const icon = ensureIconFile();
    for (const lnk of shortcutPaths()) {
      if (!fs.existsSync(lnk)) continue;
      let info;
      try { info = shell.readShortcutLink(lnk); } catch { continue; }
      // atalho de outro programa ou de outra instalação: não mexe
      if (!samePath(info.target, process.execPath)) continue;
      if (samePath(info.icon, icon)) continue;
      shell.writeShortcutLink(lnk, 'update', { icon, iconIndex: 0 });
      log.info('ícone do atalho atualizado', lnk);
    }
  } catch (err) {
    log.warn('não foi possível atualizar o ícone dos atalhos', err);
  }
}

module.exports = { updateShortcutIcons };
