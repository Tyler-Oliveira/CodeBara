export type CodebaraMood = 'chill' | 'sarcastic' | 'goblin';

export type CodebaraAnimation =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'munch'
  | 'panic'
  | 'celebrate'
  | 'inspect';

export interface DiagnosticsPayload {
  fileName?: string;
  errors: number;
  warnings: number;
  todos: number;
  lineCount: number;
  hasLonelyImport: boolean;
}
