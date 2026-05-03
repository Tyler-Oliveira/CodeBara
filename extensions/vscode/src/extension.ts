import * as path from 'path';
import * as vscode from 'vscode';
import { BridgeClient, DiagnosticsPayload } from './bridgeClient';

let client: BridgeClient;
let lastErrors = 0;
let lastCommentAt = 0;
let moodIndex = 0;
const moods = ['chill', 'sarcastic', 'goblin'] as const;
const ambientComments = [
  'I see the plan. I am choosing patience.',
  'This code has main character energy.',
  'A semicolon would not have hurt anyone.',
  'I am watching this architecture develop opinions.',
  'Interesting indentation strategy. Very interpretive.',
  'This file is looking at me funny.'
];

export function activate(context: vscode.ExtensionContext): void {
  client = new BridgeClient(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('codebara.summon', async () => {
      await client.send({ type: 'summon' });
      await sendCurrentEditorState(true);
    }),
    vscode.commands.registerCommand('codebara.hide', async () => {
      await client.send({ type: 'hide' }, false);
    }),
    vscode.commands.registerCommand('codebara.say', async () => {
      const message = await vscode.window.showInputBox({ prompt: 'What should Codebara say?' });
      if (message) {
        await client.send({ type: 'say', message });
      }
    }),
    vscode.commands.registerCommand('codebara.toggleMood', async () => {
      moodIndex = (moodIndex + 1) % moods.length;
      await client.send({ type: 'mood', mood: moods[moodIndex] });
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void client.send({
        type: 'editorChanged',
        fileName: vscode.window.activeTextEditor ? path.basename(vscode.window.activeTextEditor.document.fileName) : undefined
      }, false);
      void sendCurrentEditorState(true);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const active = vscode.window.activeTextEditor?.document.uri.toString();
      if (active === event.document.uri.toString()) {
        void sendCurrentEditorState(false);
      }
    }),
    vscode.languages.onDidChangeDiagnostics((event) => {
      const active = vscode.window.activeTextEditor?.document.uri.toString();
      if (event.uris.some((uri) => uri.toString() === active)) {
        void sendCurrentEditorState(true);
      }
    })
  );
}

export function deactivate(): void {}

async function sendCurrentEditorState(forceComment: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !(await client.isRunning())) {
    return;
  }

  const diagnostics = collectDiagnostics(editor);
  const message = buildComment(diagnostics, forceComment);
  await client.send({ type: 'diagnosticsChanged', diagnostics, message }, false);
  if (message) {
    lastCommentAt = Date.now();
  }
  lastErrors = diagnostics.errors;
}

function collectDiagnostics(editor: vscode.TextEditor): DiagnosticsPayload {
  const text = editor.document.getText();
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);

  return {
    fileName: path.basename(editor.document.fileName),
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error).length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning).length,
    todos: (text.match(/\bTODO\b/gi) || []).length,
    lineCount: editor.document.lineCount,
    hasLonelyImport: /^\s*import\s+['"][^'"]+['"];?\s*$/m.test(text)
  };
}

function buildComment(diagnostics: DiagnosticsPayload, forceComment: boolean): string | undefined {
  if (!forceComment && diagnostics.errors === 0 && diagnostics.todos === 0 && diagnostics.lineCount < 450 && Date.now() - lastCommentAt < 32000) {
    return undefined;
  }
  if (diagnostics.errors >= 5) {
    return 'The red squiggles have unionized.';
  }
  if (diagnostics.errors > 0) {
    return `${diagnostics.errors} error${diagnostics.errors === 1 ? '' : 's'}. I would simply not do that.`;
  }
  if (lastErrors > 0 && diagnostics.errors === 0) {
    return 'No errors. Suspiciously competent.';
  }
  if (diagnostics.todos > 0) {
    return 'The TODOs are aging with dignity.';
  }
  if (diagnostics.lineCount > 450) {
    return 'This file is becoming a lifestyle choice.';
  }
  if (diagnostics.hasLonelyImport) {
    return 'That import is standing there like it pays rent.';
  }
  if (diagnostics.warnings > 0) {
    return `${diagnostics.warnings} warning${diagnostics.warnings === 1 ? '' : 's'}. The compiler is side-eyeing this.`;
  }
  if (!forceComment) {
    return ambientComments[Math.floor(Math.random() * ambientComments.length)];
  }
  return 'No errors. I am choosing not to be impressed.';
}
