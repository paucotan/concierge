'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = fs.existsSync(path.join(process.cwd(), 'ai-provider.json'))
  ? path.join(process.cwd(), 'ai-provider.json')
  : path.join(__dirname, 'ai-provider.json');
const DEFAULTS = {
  provider: 'ollama',
  model: 'gemma2:2b',
  baseUrl: 'http://localhost:11434',
};

function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (e) {
    return DEFAULTS;
  }
}

function callAI(prompt) {
  const config = loadConfig();
  if (config.provider === 'ollama') {
    const ollamaCfg = config.ollama || {};
    const model = config.model || ollamaCfg.model || 'gemma2:2b';
    const baseUrl = config.baseUrl || ollamaCfg.baseUrl || 'http://localhost:11434';
    return callOllama(prompt, { model, baseUrl });
  } else if (config.provider === 'openai') {
    return callOpenAI(prompt, config);
  } else {
    return callClaude(prompt, config);
  }
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
    model: cfg.model || 'gemma2:2b',
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

function callOpenAI(prompt, cfg) {
  const apiKey = process.env.OPENAI_API_KEY || cfg.apiKey;
  if (!apiKey) throw new Error('API Key is missing for OpenAI-Compatible provider. Please configure it in Settings.');

  const body = JSON.stringify({
    model: cfg.model || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });
  const baseUrl = cfg.baseUrl || 'https://api.openai.com/v1';
  const url = `${baseUrl}/chat/completions`;
  const r = spawnSync('curl', [
    '-s',
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-H',
    `Authorization: Bearer ${apiKey}`,
    '-d',
    body,
    url,
  ], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`curl failed: ${r.stderr}`);
  let parsed;
  try { parsed = JSON.parse(r.stdout); }
  catch (e) { throw new Error(`API response not JSON: ${r.stdout.slice(0, 200)}`); }
  if (parsed.error) throw new Error(`API Error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  
  if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
    return parsed.choices[0].message.content;
  }
  throw new Error(`Unexpected API response structure: ${JSON.stringify(parsed)}`);
}

module.exports = { callAI, loadConfig };
