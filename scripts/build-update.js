// Gera a atualização leve da versão do package.json:
//   release/teka-app-<versão>.asar  (electron/ + dist/ + package.json)
//   release/teka-update.json        (versão, shellMin, sha512, tamanho)
// Os dois vão como assets da release no GitHub, junto com o instalador.
// Rode com: npm run dist:update  (faz o vite build antes)

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');
const { currentShellDeps, diffShellDeps, readPkg, ROOT } = require('./shell-deps');

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

async function main() {
  const pkg = readPkg();
  const { version } = pkg;
  const shellMin = pkg.teka?.shellMin;
  if (!shellMin) throw new Error('package.json sem teka.shellMin; gere o instalador uma vez (npm run dist:win)');

  // Electron ou módulo nativo mudou desde o último instalador: o pacote leve
  // quebraria quem está na casca antiga
  const changed = diffShellDeps(pkg.teka.shellDeps, currentShellDeps(pkg));
  if (changed.length) {
    throw new Error(`a casca mudou desde o instalador ${shellMin}:\n  ${changed.join('\n  ')}\n`
      + 'esta versão precisa de instalador completo: rode npm run dist:win');
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ vazio: rode vite build');

  // Monta numa pasta temporária só o que entra no pacote
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'teka-update-'));
  try {
    copyDir(path.join(ROOT, 'electron'), path.join(stage, 'electron'));
    copyDir(path.join(ROOT, 'dist'), path.join(stage, 'dist'));
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(stage, 'package.json'));

    const outDir = path.join(ROOT, 'release');
    fs.mkdirSync(outDir, { recursive: true });
    const file = `teka-app-${version}.asar`;
    const out = path.join(outDir, file);
    await asar.createPackage(stage, out);

    const data = fs.readFileSync(out);
    const manifest = {
      version,
      shellMin,
      file,
      sha512: crypto.createHash('sha512').update(data).digest('base64'),
      size: data.length,
    };
    fs.writeFileSync(path.join(outDir, 'teka-update.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`pacote leve ${version} pronto: ${file} (${Math.round(data.length / 1024)} KB), roda sobre o instalador ${shellMin}+`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('PACOTE LEVE FALHOU:', err.message || err);
  process.exit(1);
});
