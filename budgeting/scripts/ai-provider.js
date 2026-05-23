'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = fs.existsSync(path.join(process.cwd(), 'ai-provider.json'))
  ? path.join(process.cwd(), 'ai-provider.json')
  : path.join(__dirname, 'ai-provider.json');
const DEFAULTS = {
  provider: 'claude',
  ollama: { model: 'gemma4:e4b', baseUrl: 'http://localhost:11434' },
};

function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return DEFAULTS;
  }
}

function callAI(prompt) {
  const config = loadConfig();
  return config.provider === 'ollama'
    ? callOllama(prompt, config.ollama)
    : callClaude(prompt, config);
}

function callClaude(prompt, config = {}) {
  const claudeBin = process.env.CLAUDE_BIN || config.claudePath || path.join(require('os').homedir(), '.local/bin/claude');
  const r = spawnSync(claudeBin, ['--print', prompt], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, HOME: process.env.HOME || require('os').homedir() },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || 'Claude non-zero exit');
  return r.stdout;
}

function callOllama(prompt, cfg) {
  const body = JSON.stringify({
    model: cfg.model || 'gemma4:e4b',
    prompt,
    stream: false,
  });
  const url = `${cfg.baseUrl || 'http://localhost:11434'}/api/generate`;
  const r = spawnSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', body, url], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`curl failed: ${r.stderr}`);
  let parsed;
  try { parsed = JSON.parse(r.stdout); }
  catch (e) { throw new Error(`Ollama response not JSON: ${r.stdout.slice(0, 200)}`); }
  if (parsed.error) throw new Error(`Ollama: ${parsed.error}`);
  return parsed.response || '';
}

module.exports = { callAI, loadConfig };
