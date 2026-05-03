import { desktopCapturer } from 'electron';
import * as https from 'https';

export interface ScreenObservation {
  message: string;
  target?: { x: number; y: number };
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[];
}

interface RawObservation {
  say?: unknown;
  target?: {
    x?: unknown;
    y?: unknown;
  };
}

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicObserver {
  private readonly apiKey = process.env.ANTHROPIC_API_KEY;
  private readonly model = process.env.CODEBARA_ANTHROPIC_MODEL || DEFAULT_MODEL;
  private lastMessage = '';

  public get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  public async observe(displayId: number): Promise<ScreenObservation | undefined> {
    if (!this.apiKey) {
      return undefined;
    }

    const image = await this.capturePrimaryDisplay(displayId);
    if (!image) {
      return undefined;
    }

    const response = await this.requestObservation(image);
    const observation = this.parseObservation(response);
    if (!observation || observation.message === this.lastMessage) {
      return undefined;
    }

    this.lastMessage = observation.message;
    return observation;
  }

  private async capturePrimaryDisplay(displayId: number): Promise<string | undefined> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });
    const source = sources.find((candidate) => candidate.display_id === String(displayId)) || sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      return undefined;
    }

    return source.thumbnail.toPNG().toString('base64');
  }

  private requestObservation(imageBase64: string): Promise<string> {
    const payload = JSON.stringify({
      model: this.model,
      max_tokens: 120,
      system: [
        'You are the dry, funny mind of a small desktop coding companion.',
        'Look at the screenshot and usually choose one visible thing to inspect.',
        'Focus on visible code, errors, UI state, text, or obvious user activity.',
        'Do not identify people, do not quote secrets/tokens/keys, and do not mention private-looking data.',
        'Be playful and lightly judgmental, never cruel. Prefer jokes like: "If this was me I would not write code like this."',
        'Respond only as compact JSON: {"say":"brief sentence","target":{"x":0.5,"y":0.5}}.',
        'Use null only if the screen is blank or private-looking. Keep say under 14 words.'
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: 'Pick one visible thing to walk over and judge. Return a short funny comment and a normalized target point near it.'
            }
          ]
        }
      ]
    });

    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION
          },
          timeout: 12000
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode || 500) >= 400) {
              reject(new Error(`Anthropic request failed with HTTP ${response.statusCode}: ${body}`));
              return;
            }

            try {
              const parsed = JSON.parse(body) as AnthropicResponse;
              resolve(parsed.content?.find((block) => block.type === 'text')?.text || '');
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      request.on('timeout', () => request.destroy(new Error('Anthropic request timed out.')));
      request.on('error', reject);
      request.write(payload);
      request.end();
    });
  }

  private parseObservation(response: string): ScreenObservation | undefined {
    const jsonText = response.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let raw: RawObservation;

    try {
      raw = JSON.parse(jsonText) as RawObservation;
    } catch {
      return undefined;
    }

    if (typeof raw.say !== 'string' || !raw.say.trim()) {
      return undefined;
    }

    const message = raw.say.trim().slice(0, 120);
    const target = this.parseTarget(raw.target);
    return target ? { message, target } : { message };
  }

  private parseTarget(target: RawObservation['target']): { x: number; y: number } | undefined {
    if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
      return undefined;
    }

    return {
      x: Math.min(Math.max(target.x, 0), 1),
      y: Math.min(Math.max(target.y, 0), 1)
    };
  }
}
