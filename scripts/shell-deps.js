// "Casca" do app = o que só o instalador troca: o Electron e os módulos de
// node_modules (vários são nativos). O pacote leve leva só electron/ e dist/,
// então ele só pode rodar sobre uma casca com exatamente estas versões.
//
// package.json guarda em "teka":
//   shellMin  - a primeira versão do instalador com a casca atual
//   shellDeps - as versões instaladas quando essa casca foi gerada

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function installedVersion(name) {
  const file = path.join(ROOT, 'node_modules', name, 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function currentShellDeps(pkg) {
  const deps = { electron: installedVersion('electron') };
  for (const name of Object.keys(pkg.dependencies || {}).sort()) deps[name] = installedVersion(name);
  return deps;
}

// Lista das diferenças, vazia quando a casca é a mesma
function diffShellDeps(recorded, current) {
  const names = new Set([...Object.keys(recorded || {}), ...Object.keys(current)]);
  return [...names].filter((n) => (recorded || {})[n] !== current[n])
    .map((n) => `${n}: ${(recorded || {})[n] || '(nenhum)'} -> ${current[n] || '(removido)'}`);
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function writePkg(pkg) {
  fs.writeFileSync(path.join(ROOT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

module.exports = { currentShellDeps, diffShellDeps, readPkg, writePkg, ROOT };
