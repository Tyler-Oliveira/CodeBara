import type { CodebaraAnimation, CodebaraMood, DiagnosticsPayload } from './types';

export const CODEBARA_BRIDGE_PORT = 47322;
export const CODEBARA_BRIDGE_HOST = '127.0.0.1';

export type CodebaraEvent =
  | { type: 'summon' }
  | { type: 'hide' }
  | { type: 'quit' }
  | { type: 'say'; message: string }
  | { type: 'mood'; mood: CodebaraMood }
  | { type: 'editorChanged'; fileName?: string }
  | { type: 'diagnosticsChanged'; diagnostics: DiagnosticsPayload; message?: string }
  | { type: 'terminalError'; message?: string }
  | { type: 'terminalSuccess'; message?: string }
  | { type: 'celebrate'; message?: string }
  | { type: 'panic'; message?: string }
  | { type: 'observation'; message: string; target?: { x: number; y: number } }
  | { type: 'animation'; animation: CodebaraAnimation; message?: string };

export interface BridgeStatus {
  running: boolean;
  visible: boolean;
  mood: CodebaraMood;
}
