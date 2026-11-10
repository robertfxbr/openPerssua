// Atualização pelo GitHub Releases do projeto.
//
// Fluxo: consulta a release mais recente, compara com a versão instalada e,
// se o usuário pedir, baixa o instalador e confere o SHA-512 contra o
// latest.yml que o electron-builder publica junto. Sem latest.yml (ou com
// hash diferente) o instalador não roda: aí só oferecemos abrir a página.
// O instalador não é assinado, então quem decide instalar é sempre o usuário.

const { app, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'robertfxbr/openPerssua';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

// "v0.3.1" -> [0, 3, 1]; texto inválido -> null
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// latest.yml do electron-builder: pega o sha512 do arquivo principal
function parseLatestYml(text) {
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  const shaMatch = text.match(/^sha512:\s*(\S+)$/m);
  if (!pathMatch || !shaMatch) return null;
  return { path: pathMatch[1].trim().replace(/^['"]|['"]$/g, ''), sha512: shaMatch[1].trim() };
}

let lastRelease = null; // resultado do último check, usado pelo download

async function checkForUpdate() {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Teka-updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return { available: false, current: app.getVersion(), note: 'nenhuma release publicada ainda' };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const exe = assets.find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name));
  const yml = assets.find((a) => a.name === 'latest.yml');
  const safeUrl = (a) => (a && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX) ? a.browser_download_url : null);
  lastRelease = {
    version,
    exeUrl: safeUrl(exe),
    exeName: exe?.name || null,
    exeSize: exe?.size || 0,
    ymlUrl: safeUrl(yml),
  };
  return {
    available: isNewer(version, app.getVersion()),
    current: app.getVersion(),
    version,
    notes: String(rel.body || '').slice(0, 2000),
    pageUrl: String(rel.html_url || RELEASES_PAGE).startsWith('https://github.com/') ? rel.html_url : RELEASES_PAGE,
    canInstall: process.platform === 'win32' && Boolean(lastRelease.exeUrl && lastRelease.ymlUrl),
  };
}

async function downloadUpdate(onProgress) {
  const rel = lastRelease;
  if (!rel?.exeUrl || !rel.ymlUrl) throw new Error('esta release não tem instalador verificável; use "abrir página"');
  if (!isNewer(rel.version, app.getVersion())) throw new Error('já está na versão mais recente');

  const ymlRes = await fetch(rel.ymlUrl, { signal: AbortSignal.timeout(15000) });
  if (!ymlRes.ok) throw new Error(`latest.yml: HTTP ${ymlRes.status}`);
  const meta = parseLatestYml(await ymlRes.text());
  if (!meta) throw new Error('latest.yml sem hash do instalador');

  const dir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const safeName = path.basename(rel.exeName).replace(/[^\w .-]/g, '_');
  const dest = path.join(dir, safeName);
  const tmp = `${dest}.part`;

  const res = await fetch(rel.exeUrl);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || rel.exeSize || 0;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      out.write(value);
      received += value.length;
      if (onProgress && total) onProgress({ received, total });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (hash.digest('base64') !== meta.sha512) {
    fs.rmSync(tmp, { force: true });
    throw new Error('o arquivo baixado não confere com o hash da release; nada foi instalado');
  }
  fs.renameSync(tmp, dest);
  return { ok: true, file: dest, version: rel.version };
}

// Só aceita instaladores que o próprio downloadUpdate deixou na pasta
function installUpdate(file) {
  const dir = path.join(app.getPath('userData'), 'updates');
  const resolved = path.resolve(String(file || ''));
  if (path.dirname(resolved) !== dir || !fs.existsSync(resolved)) {
    return { ok: false, error: 'instalador não encontrado; baixe de novo' };
  }
  spawn(resolved, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 500);
  return { ok: true };
}

function openReleasesPage(url) {
  const target = typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`) ? url : RELEASES_PAGE;
  shell.openExternal(target);
  return { ok: true };
}

module.exports = {
  checkForUpdate, downloadUpdate, installUpdate, openReleasesPage, isNewer, parseLatestYml,
};
