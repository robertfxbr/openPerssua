// Logs de debug do electron-log: abrir a pasta ou copiar o trecho mais
// recente para colar numa issue do GitHub.

const fs = require('fs');
const { shell, clipboard } = require('electron');
const log = require('electron-log');

const COPY_TAIL_BYTES = 64 * 1024; // últimos 64 KB bastam para diagnosticar

function logFilePath() {
  return log.transports.file.getFile().path;
}

function openLogsFolder() {
  const file = logFilePath();
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else return { ok: false, error: 'arquivo de log ainda não existe' };
  return { ok: true, path: file };
}

function copyRecentLogs() {
  const file = logFilePath();
  if (!fs.existsSync(file)) return { ok: false, error: 'arquivo de log ainda não existe' };
  const { size } = fs.statSync(file);
  const start = Math.max(0, size - COPY_TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    // Se cortou no meio de uma linha, descarta a linha incompleta do começo
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    clipboard.writeText(text);
    return { ok: true, bytes: buf.length };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { openLogsFolder, copyRecentLogs, logFilePath };
