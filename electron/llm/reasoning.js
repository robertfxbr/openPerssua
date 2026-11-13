const { spawn } = require('child_process');
const os = require('os');
const helpCache = new Map();

function reasoningOptions(req, enabled) {
  const fast = req.mode === 'assist';
  return { fast, thinkMore: enabled === true && !fast && [undefined, 'chat', 'screen'].includes(req.mode) };
}

function effortCandidates({ fast, thinkMore }) {
  return fast ? ['none', 'minimal', 'low', undefined]
    : thinkMore ? ['medium', 'high', 'low', 'none', undefined] : ['low', undefined];
}

function cliEffortArgs(cmd, effort, help) {
  if (!effort) return [];
  if (cmd === 'codex' && help.includes('--config')) return ['-c', `model_reasoning_effort=${effort}`];
  if (cmd === 'claude' && help.includes('--effort')) return ['--effort', effort];
  return [];
}

// Só consulta --help, uma vez por execução. CLI antiga ou ausente vira no-op.
function cliHelp(cmd) {
  if (!['codex', 'claude'].includes(cmd)) return Promise.resolve('');
  if (!helpCache.has(cmd)) helpCache.set(cmd, new Promise((resolve) => {
    const child = spawn(cmd, cmd === 'codex' ? ['exec', '--help'] : ['--help'], { shell: true, cwd: os.tmpdir(), windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve(''); }, 5000);
    child.stdout.on('data', (data) => { output = (output + data).slice(0, 50000); });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? output : ''); });
    child.stdin.end();
  }));
  return helpCache.get(cmd);
}

const isEffortError = (error) => /(?:reasoning|effort).*(?:unsupported|not supported|invalid|unknown)|(?:unsupported|not supported|invalid|unknown|unexpected).*(?:reasoning|effort)/i.test(String(error?.message || error));

module.exports = { reasoningOptions, effortCandidates, cliEffortArgs, cliHelp, isEffortError };
