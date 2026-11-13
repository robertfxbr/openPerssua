// Whisper na placa de vídeo.
//
// O whisper-server que vem com o Teka roda só no processador. Para usar a
// placa, o app baixa uma vez um segundo whisper-server:
//   - NVIDIA: o pacote CUDA oficial do whisper.cpp (ggml-org);
//   - AMD e Intel: o pacote Vulkan que o robô deste repositório compila a
//     partir do código oficial (.github/workflows/whisper-vulkan.yml).
// Os dois têm URL e SHA-256 fixos aqui: o arquivo só é usado se o hash bater.
// Se a placa falhar ao carregar o modelo, o WhisperService volta para o
// processador sozinho.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PACKS = {
  vulkan: {
    label: 'Vulkan',
    url: 'https://github.com/robertfxbr/openPerssua/releases/download/whisper-vulkan-v1.9.5/whisper-vulkan-x64.zip',
    // run 43485481887 do robô (whisper.cpp v1.9.5 + Vulkan SDK 1.4.363.1)
    sha256: '815a7c4d1ad375512403c9f158b55078c1223b50709f371b42036c2ffe2942d6',
    size: 18678049,
    dir: 'whisper-gpu-vulkan',
  },
  cuda: {
    label: 'CUDA',
    // CUDA 11.8: metade do tamanho do pacote 12.4 e roda com drivers mais
    // antigos. Placa que o CUDA não aceitar cai para o processador.
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-11.8.0-x64.zip',
    sha256: 'e81c86c542be6e3d7b7245392d4e1c52ab6e5c61dbe38721754bc0ab59d4d027',
    size: 284761231,
    dir: 'whisper-gpu-cuda',
  },
};

// IDs PCI dos fabricantes
const VENDORS = { 0x10de: 'nvidia', 0x1002: 'amd', 0x1022: 'amd', 0x8086: 'intel' };
const VENDOR_LABEL = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };

// Placas que o Electron vê. Placa virtual (Parsec, área de trabalho remota)
// não tem fabricante conhecido e fica de fora. Com mais de uma, a NVIDIA
// ganha (tem o pacote mais rápido), depois AMD, depois Intel.
async function detectGpu(app) {
  let info = null;
  try { info = await app.getGPUInfo('complete'); } catch { /* sem GPU acessível */ }
  if (!info) { try { info = await app.getGPUInfo('basic'); } catch { return null; } }
  const devices = (info?.gpuDevice || [])
    .map((d) => ({ vendor: VENDORS[d.vendorId], name: d.deviceString || '' }))
    .filter((d) => d.vendor);
  const order = ['nvidia', 'amd', 'intel'];
  devices.sort((a, b) => order.indexOf(a.vendor) - order.indexOf(b.vendor));
  const gpu = devices[0];
  if (!gpu) return null;
  return {
    vendor: gpu.vendor,
    name: gpu.name || `placa ${VENDOR_LABEL[gpu.vendor]}`,
    pack: gpu.vendor === 'nvidia' ? 'cuda' : 'vulkan',
  };
}

function packDir(userDataDir, kind) {
  return path.join(userDataDir, PACKS[kind].dir);
}

// whisper-server.exe de um pacote instalado (o zip oficial pode ter pasta)
function findServer(dir) {
  if (!fs.existsSync(dir)) return null;
  const direct = path.join(dir, 'whisper-server.exe');
  if (fs.existsSync(direct)) return direct;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const inner = path.join(dir, entry.name, 'whisper-server.exe');
    if (fs.existsSync(inner)) return inner;
  }
  return null;
}

function serverFor(userDataDir, kind) {
  return PACKS[kind] ? findServer(packDir(userDataDir, kind)) : null;
}

// Baixa, confere o SHA-256 e extrai com o tar do Windows (vem desde o
// Windows 10 1803 e abre .zip). Só troca a pasta final quando tudo deu certo.
async function installPack(userDataDir, kind, { onProgress, signal } = {}) {
  const pack = PACKS[kind];
  if (!pack) throw new Error(`pacote desconhecido: ${kind}`);
  if (!/^[0-9a-f]{64}$/.test(pack.sha256)) throw new Error('pacote ainda não publicado');
  const final = packDir(userDataDir, kind);
  const zip = `${final}.zip.part`;
  const tmpDir = `${final}.tmp`;
  fs.rmSync(zip, { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await fetch(pack.url, { signal });
  if (!res.ok) throw new Error(`download do suporte à placa falhou: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || pack.size;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(zip);
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > pack.size * 1.1 + 1e6) throw new Error('arquivo maior que o esperado');
      hash.update(value);
      out.write(value);
      if (onProgress && total) onProgress({ kind, received, total });
    }
  } catch (err) {
    await new Promise((r) => out.end(r));
    fs.rmSync(zip, { force: true });
    if (signal?.aborted) throw new Error('download cancelado');
    throw err;
  }
  await new Promise((r) => out.end(r));
  if (hash.digest('hex') !== pack.sha256) {
    fs.rmSync(zip, { force: true });
    throw new Error('o arquivo baixado não confere com o hash esperado; nada foi instalado');
  }

  fs.mkdirSync(tmpDir, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  await new Promise((resolve, reject) => {
    execFile(tar, ['-xf', zip, '-C', tmpDir], { windowsHide: true }, (err) => (err ? reject(new Error(`não foi possível extrair: ${err.message}`)) : resolve()));
  });
  fs.rmSync(zip, { force: true });
  if (!findServer(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error('o pacote não trouxe o whisper-server');
  }
  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(tmpDir, final);
  return { ok: true, kind };
}

function removePack(userDataDir, kind) {
  if (!PACKS[kind]) return;
  fs.rmSync(packDir(userDataDir, kind), { recursive: true, force: true });
}

// O que o whisper-server escreveu ao subir diz se a placa entrou mesmo:
// "using Vulkan0 backend" / "using CUDA0 backend". Sem isso, ele caiu para
// o processador (driver velho, placa não suportada).
function parseBackend(log) {
  const m = /using (Vulkan|CUDA)\d* backend/i.exec(log || '');
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'cuda' ? 'cuda' : 'vulkan';
  const dev = kind === 'vulkan'
    ? /ggml_vulkan: \d+ = ([^|(\r\n]+)/.exec(log)
    : /Device \d+: ([^,\r\n]+)/.exec(log);
  return { kind, device: dev ? dev[1].trim() : null };
}

module.exports = { PACKS, VENDOR_LABEL, detectGpu, serverFor, installPack, removePack, parseBackend };
