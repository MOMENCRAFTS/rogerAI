/**
 * pttHardware.ts — Capacitor bridge for the native PttButtonPlugin.
 *
 * Listens for pttDown / pttUp events fired from the FAS Bluetooth speaker
 * button and routes them to the PTT state machine in PTTTestLab.
 *
 * On web/desktop (non-native), this is a no-op — spacebar + touch still work.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface PttButtonPlugin {
  getMappedKeycodes(): Promise<{ keycodes: string }>;
  addListener(
    event: 'pttDown',
    handler: (data: { keyCode: number; state: string }) => void
  ): Promise<{ remove: () => void }>;
  addListener(
    event: 'pttUp',
    handler: (data: { keyCode: number; state: string }) => void
  ): Promise<{ remove: () => void }>;
}

// Register — only wires up on native Android/iOS, no-op on web
export const PttButton = registerPlugin<PttButtonPlugin>('PttButton');

export const isNative = Capacitor.isNativePlatform();

/**
 * Attach hardware PTT listeners. Returns a cleanup function.
 *
 * Usage:
 *   const cleanup = attachPttHardware(handlePTTDown, handlePTTUp);
 *   return cleanup; // in useEffect
 */
export async function attachPttHardware(
  onDown: () => void,
  onUp: () => void
): Promise<() => void> {
  if (!isNative) return () => {}; // no-op on web

  const downHandle = await PttButton.addListener('pttDown', (data) => {
    console.debug('[PTT HW] Button DOWN — keyCode:', data.keyCode);
    onDown();
  });

  const upHandle = await PttButton.addListener('pttUp', (data) => {
    console.debug('[PTT HW] Button UP — keyCode:', data.keyCode);
    onUp();
  });

  console.info('[PTT HW] Hardware PTT listeners attached');

  return () => {
    downHandle.remove();
    upHandle.remove();
    console.info('[PTT HW] Hardware PTT listeners removed');
  };
}
