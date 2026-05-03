import { EventEmitter } from 'events';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { CODEBARA_BRIDGE_HOST, CODEBARA_BRIDGE_PORT, CodebaraEvent, BridgeStatus } from '@codebara/shared/dist/events';

export class BridgeServer extends EventEmitter {
  private server: Server | undefined;

  public start(getStatus: () => BridgeStatus): void {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      this.setCors(response);

      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === 'GET' && request.url === '/status') {
        this.sendJson(response, 200, getStatus());
        return;
      }

      if (request.method === 'POST' && request.url === '/event') {
        void this.readEvent(request)
          .then((event) => {
            this.emit('event', event);
            this.sendJson(response, 200, { ok: true });
          })
          .catch((error: Error) => {
            this.sendJson(response, 400, { ok: false, error: error.message });
          });
        return;
      }

      this.sendJson(response, 404, { ok: false });
    });

    this.server.listen(CODEBARA_BRIDGE_PORT, CODEBARA_BRIDGE_HOST);
  }

  public stop(): void {
    this.server?.close();
    this.server = undefined;
  }

  private readEvent(request: IncomingMessage): Promise<CodebaraEvent> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const event = JSON.parse(body) as CodebaraEvent;
          if (!event || typeof event.type !== 'string') {
            reject(new Error('Invalid Codebara event.'));
            return;
          }
          resolve(event);
        } catch {
          reject(new Error('Invalid JSON body.'));
        }
      });
      request.on('error', reject);
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }

  private setCors(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', 'http://localhost');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
}
