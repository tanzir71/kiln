import { registerClipboardBridge } from './clipboard';
import { registerCustomBridge } from './custom';
import { registerFileBridge } from './fs';
import { registerNotificationBridge } from './notify';
import { registerShellBridge } from './shell';
import { registerShortcutBridge } from './shortcuts';
import { registerStoreBridge } from './store';
import { registerSystemBridge } from './system';
import { registerTrayBridge } from './tray';

export function registerBridge(): void {
  registerFileBridge();
  registerShellBridge();
  registerStoreBridge();
  registerNotificationBridge();
  registerTrayBridge();
  registerShortcutBridge();
  registerClipboardBridge();
  registerSystemBridge();
  registerCustomBridge();
}
