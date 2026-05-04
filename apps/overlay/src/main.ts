import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import { AnthropicObserver } from './awareness/anthropicObserver';
import { BridgeServer } from './bridge/server';
import { BridgeStatus, CodebaraEvent } from '@codebara/shared/dist/events';
import { CodebaraMood } from '@codebara/shared/dist/types';

let windowRef: BrowserWindow | undefined;
let tray: Tray | undefined;
let clickThrough = true;
let visible = false;
let mood: CodebaraMood = 'chill';
let awarenessTimer: NodeJS.Timeout | undefined;
let focusMonitor: ChildProcessWithoutNullStreams | undefined;
let vscodeFocused = false;
let wantsOverlay = false;
let draggingOverlay = false;

const bridge = new BridgeServer();
const observer = new AnthropicObserver();
const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
}

app.on('second-instance', () => {
  wantsOverlay = true;
  showOverlay();
  sendEvent({ type: 'summon' });
});

app.whenReady().then(() => {
  createOverlayWindow();
  createTray();
  bridge.start(getStatus);
  bridge.on('event', handleBridgeEvent);
  startFocusMonitor();
  scheduleAwarenessCheck(7000);
});

app.on('window-all-closed', () => {
  // Keep the tray and bridge alive after the transparent window is hidden.
});

app.on('before-quit', () => {
  if (awarenessTimer) {
    clearTimeout(awarenessTimer);
  }
  focusMonitor?.kill();
  bridge.stop();
});

function createOverlayWindow(): void {
  const bounds = screen.getPrimaryDisplay().bounds;

  windowRef = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: true,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  windowRef.setAlwaysOnTop(true, 'screen-saver');
  windowRef.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setOverlayInteractive(false);
  void windowRef.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  screen.on('display-metrics-changed', resizeToPrimaryDisplay);
  screen.on('display-added', resizeToPrimaryDisplay);
  screen.on('display-removed', resizeToPrimaryDisplay);
}

function createTray(): void {
  const iconPath = path.join(__dirname, '..', 'assets', 'capybara', 'charlie-sitting-idle.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Codebara');
  updateTrayMenu();
}

function updateTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Summon', click: () => handleBridgeEvent({ type: 'summon' }) },
    { label: 'Hide', click: () => handleBridgeEvent({ type: 'hide' }) },
    {
      label: `Click-through: ${clickThrough ? 'On' : 'Off'}`,
      click: () => {
        clickThrough = !clickThrough;
        setOverlayInteractive(false);
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

function handleBridgeEvent(event: CodebaraEvent): void {
  switch (event.type) {
    case 'summon':
      wantsOverlay = true;
      showOverlay();
      break;
    case 'hide':
      wantsOverlay = false;
      visible = false;
      windowRef?.hide();
      break;
    case 'quit':
      app.quit();
      return;
    case 'mood':
      mood = event.mood;
      break;
    default:
      break;
  }

  if (event.type !== 'hide') {
    showOverlay();
  }
  sendEvent(event);
}

function showOverlay(): void {
  wantsOverlay = true;
  if (!vscodeFocused) {
    visible = false;
    windowRef?.hide();
    return;
  }

  visible = true;
  resizeToPrimaryDisplay();
  windowRef?.showInactive();
}

function resizeToPrimaryDisplay(): void {
  const bounds = screen.getPrimaryDisplay().bounds;
  windowRef?.setBounds(bounds);
}

function sendEvent(event: CodebaraEvent): void {
  windowRef?.webContents.send('codebara:event', event);
}

function getStatus(): BridgeStatus {
  return { running: true, visible, mood };
}

function scheduleAwarenessCheck(delay = nextAwarenessDelay()): void {
  if (!observer.enabled) {
    return;
  }

  if (awarenessTimer) {
    clearTimeout(awarenessTimer);
  }

  awarenessTimer = setTimeout(() => {
    void runAwarenessCheck();
  }, delay);
}

async function runAwarenessCheck(): Promise<void> {
  try {
    if (visible) {
      const displayId = screen.getPrimaryDisplay().id;
      const observation = await observer.observe(displayId);
      if (observation) {
        sendEvent({ type: 'observation', message: observation.message, target: observation.target });
      }
    }
  } catch {
    // Awareness is optional; failures should not break the companion.
  } finally {
    scheduleAwarenessCheck();
  }
}

function nextAwarenessDelay(): number {
  return 28000 + Math.round(Math.random() * 26000);
}

function startFocusMonitor(): void {
  if (process.platform !== 'win32') {
    return;
  }

  const command = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@;
$codebaraProcessId = ${process.pid};
function Get-ForegroundProcessName {
  $hwnd = [Win32]::GetForegroundWindow();
  [uint32]$processId = 0;
  [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null;
  if ($processId -le 0) { return "" }
  if ($processId -eq $codebaraProcessId) { return "__codebara__" }
  (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
}
$last = "";
while ($true) {
  $current = Get-ForegroundProcessName;
  if ($current -ne $last) {
    Write-Output $current;
    [Console]::Out.Flush();
    $last = $current;
  }
  Start-Sleep -Milliseconds 100;
}
`.trim();

  focusMonitor = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true
  });

  let buffered = '';
  focusMonitor.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) {
      applyFocusedProcess(line.trim());
    }
  });
  focusMonitor.on('exit', () => {
    focusMonitor = undefined;
  });
}

function applyFocusedProcess(processName: string): void {
  if (draggingOverlay || processName === '__codebara__') {
    return;
  }

  const isFocused = isVSCodeProcess(processName);
  if (isFocused === vscodeFocused) {
    return;
  }

  vscodeFocused = isFocused;
  if (!vscodeFocused) {
    visible = false;
    windowRef?.hide();
    return;
  }

  if (wantsOverlay) {
    visible = true;
    resizeToPrimaryDisplay();
    windowRef?.showInactive();
  }
}

function isVSCodeProcess(processName: string): boolean {
  return ['code', 'code - insiders', 'vscodium'].includes(processName.trim().toLowerCase());
}

ipcMain.on('codebara:mouse-interactive', (_event, interactive: boolean) => {
  setOverlayInteractive(interactive);
});

ipcMain.on('codebara:dragging', (_event, dragging: boolean) => {
  draggingOverlay = dragging;
});

function setOverlayInteractive(interactive: boolean): void {
  if (!clickThrough) {
    windowRef?.setIgnoreMouseEvents(false);
    return;
  }

  windowRef?.setIgnoreMouseEvents(!interactive, { forward: true });
}
