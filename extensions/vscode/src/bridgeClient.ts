import * as childProcess from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';

export const CODEBARA_BRIDGE_HOST = '127.0.0.1';
export const CODEBARA_BRIDGE_PORT = 47322;

export type CodebaraEvent =
  | { type: 'summon' }
  | { type: 'hide' }
  | { type: 'say'; message: string }
  | { type: 'mood'; mood: 'chill' | 'sarcastic' | 'goblin' }
  | { type: 'editorChanged'; fileName?: string }
  | { type: 'diagnosticsChanged'; diagnostics: DiagnosticsPayload; message?: string }
  | { type: 'terminalError'; message?: string }
  | { type: 'terminalSuccess'; message?: string }
  | { type: 'celebrate'; message?: string }
  | { type: 'panic'; message?: string };

export interface DiagnosticsPayload {
  fileName?: string;
  errors: number;
  warnings: number;
  todos: number;
  lineCount: number;
  hasLonelyImport: boolean;
}

export class BridgeClient {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  public async ensureOverlay(): Promise<void> {
    if (await this.isRunning()) {
      return;
    }

    const repoRoot = path.resolve(this.extensionUri.fsPath, '..', '..');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    childProcess.spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--dir', repoRoot, 'dev:overlay'], {
      detached: true,
      stdio: 'ignore',
      env,
      shell: process.platform === 'win32',
      windowsHide: true
    }).unref();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await this.isRunning()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  public async send(event: CodebaraEvent, launchIfNeeded = true): Promise<void> {
    if (launchIfNeeded) {
      await this.ensureOverlay();
    }
    await this.request('POST', '/event', event);
  }

  public async isRunning(): Promise<boolean> {
    return this.request('GET', '/status').then(() => true).catch(() => false);
  }

  private request(method: 'GET' | 'POST', route: string, body?: unknown): Promise<unknown> {
    const payload = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: CODEBARA_BRIDGE_HOST,
          port: CODEBARA_BRIDGE_PORT,
          path: route,
          method,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : undefined,
          timeout: 800
        },
        (res) => {
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
        }
      );

      req.on('timeout', () => req.destroy(new Error('Codebara bridge timed out.')));
      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}
