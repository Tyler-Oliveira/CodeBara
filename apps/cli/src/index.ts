#!/usr/bin/env node
import { spawn } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import { CODEBARA_BRIDGE_HOST, CODEBARA_BRIDGE_PORT, CodebaraEvent } from '@codebara/shared/dist/events';

const args = process.argv.slice(2);
while (args[0] === '--') {
  args.shift();
}
const command = args[0] || 'help';

void main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

async function main(): Promise<void> {
  switch (command) {
    case 'summon':
      await ensureOverlay();
      await sendEvent({ type: 'summon' });
      console.log('Codebara summoned.');
      return;
    case 'hide':
      await sendEvent({ type: 'hide' });
      console.log('Codebara hidden.');
      return;
    case 'quit':
      await sendEvent({ type: 'quit' });
      console.log('Codebara quit.');
      return;
    case 'restart':
      await sendEvent({ type: 'quit' }).catch(() => undefined);
      await delay(600);
      await ensureOverlay();
      await sendEvent({ type: 'summon' });
      console.log('Codebara restarted.');
      return;
    case 'say':
      await ensureOverlay();
      await sendEvent({ type: 'say', message: args.slice(1).join(' ') || 'hello' });
      return;
    case 'mood':
      await ensureOverlay();
      await sendEvent({ type: 'mood', mood: parseMood(args[1]) });
      return;
    case 'panic':
      await ensureOverlay();
      await sendEvent({ type: 'panic' });
      return;
    case 'celebrate':
      await ensureOverlay();
      await sendEvent({ type: 'celebrate' });
      return;
    case 'status':
      await printStatus();
      return;
    default:
      printHelp();
      return;
  }
}

async function ensureOverlay(): Promise<void> {
  if (await isRunning()) {
    return;
  }

  launchOverlay();
  const started = await waitForOverlay();
  if (!started) {
    throw new Error('Codebara overlay did not start. Run pnpm build, then try codebara summon again.');
  }
}

function launchOverlay(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as string;
  const overlayMain = path.resolve(__dirname, '..', '..', 'overlay', 'dist', 'main.js');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, [overlayMain], {
    detached: true,
    stdio: 'ignore',
    env,
    windowsHide: true
  });
  child.unref();
}

async function waitForOverlay(): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isRunning()) {
      return true;
    }
    await delay(150);
  }
  return false;
}

function isRunning(): Promise<boolean> {
  return request('GET', '/status').then(() => true).catch(() => false);
}

async function printStatus(): Promise<void> {
  try {
    const status = await request('GET', '/status');
    console.log(`Codebara overlay is running. Visible: ${Boolean(status.visible)}. Mood: ${status.mood}.`);
  } catch {
    console.log('Codebara overlay is not running.');
  }
}

function sendEvent(event: CodebaraEvent): Promise<unknown> {
  return request('POST', '/event', event);
}

function request(method: 'GET' | 'POST', route: string, body?: unknown): Promise<any> {
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const requestOptions: http.RequestOptions = {
      hostname: CODEBARA_BRIDGE_HOST,
      port: CODEBARA_BRIDGE_PORT,
      path: route,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : undefined,
      timeout: 800
    };

    const req = http.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(text || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(text ? JSON.parse(text) : {});
      });
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out.')));
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function parseMood(value: string | undefined): 'chill' | 'sarcastic' | 'goblin' {
  if (value === 'chill' || value === 'sarcastic' || value === 'goblin') {
    return value;
  }
  throw new Error('Mood must be chill, sarcastic, or goblin.');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`Codebara

Usage:
  codebara summon
  codebara hide
  codebara quit
  codebara restart
  codebara say "hello"
  codebara mood chill|sarcastic|goblin
  codebara panic
  codebara celebrate
  codebara status`);
}
