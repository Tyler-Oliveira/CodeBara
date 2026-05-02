import { contextBridge, ipcRenderer } from 'electron';
import type { CodebaraEvent } from '@codebara/shared/dist/events';

contextBridge.exposeInMainWorld('codebara', {
  onEvent(callback: (event: CodebaraEvent) => void) {
    ipcRenderer.on('codebara:event', (_ipcEvent, event: CodebaraEvent) => callback(event));
  },
  setMouseInteractive(interactive: boolean) {
    ipcRenderer.send('codebara:mouse-interactive', interactive);
  },
  setDragging(dragging: boolean) {
    ipcRenderer.send('codebara:dragging', dragging);
  }
});
