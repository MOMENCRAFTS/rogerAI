/**
 * widgetBridge.ts — Syncs user config from the web layer into native
 * Android SharedPreferences via the WidgetConfigBridge Capacitor plugin.
 *
 * Called from UserApp.tsx on mount, preference changes, and roger:refresh events.
 * Widgets read from SharedPreferences independently — no live data dependency.
 */

import { Capacitor } from '@capacitor/core';

interface WidgetConfigData {
  userId?: string;
  islamicMode?: boolean;
  latitude?: number;
  longitude?: number;
  prayerMethod?: string;
  taskCount?: number;
  reminderCount?: number;
  nextDueText?: string;
  nextDueMs?: number;
  lastResponse?: string;
}

/**
 * Push config data to native Android widgets via the WidgetConfig plugin.
 * No-ops gracefully on web/iOS where the plugin isn't available.
 */
export async function syncWidgetConfig(data: WidgetConfigData): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return; // Only runs on Android native
  }

  try {
    const { registerPlugin } = await import('@capacitor/core');
    const WidgetConfig = registerPlugin('WidgetConfig');
    await (WidgetConfig as { syncConfig: (d: WidgetConfigData) => Promise<void> }).syncConfig(data);
  } catch (e) {
    // Plugin not available — silently ignore (dev mode, iOS, etc.)
    console.debug('[WidgetBridge] syncConfig skipped:', e);
  }
}
