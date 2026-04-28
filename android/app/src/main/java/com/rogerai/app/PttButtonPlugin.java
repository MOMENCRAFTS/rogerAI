package com.rogerai.app;

import android.view.KeyEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PttButtonPlugin — Native Capacitor plugin that intercepts Bluetooth HID
 * key events from the FAS PTT speaker and bridges them to the web layer.
 *
 * Keycodes covered:
 *   85  = KEYCODE_MEDIA_PLAY_PAUSE  (most common generic PTT speaker)
 *   79  = KEYCODE_HEADSETHOOK       (headset/earpiece style)
 *  228  = KEYCODE_PTT               (Motorola/Zebra dedicated PTT)
 *   24  = KEYCODE_VOLUME_UP         (budget PTT accessories)
 *  164  = KEYCODE_MEDIA_PAUSE
 *  126  = KEYCODE_MEDIA_PLAY
 *
 * After pairing FAS and running `adb shell getevent -l`, add/remove from
 * PTT_KEYCODES below to match exactly what the FAS sends.
 */
@CapacitorPlugin(name = "PttButton")
public class PttButtonPlugin extends Plugin {

    private static final int[] PTT_KEYCODES = {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,  // 85  — most common generic PTT speaker
        KeyEvent.KEYCODE_HEADSETHOOK,       // 79  — headset/earpiece style
        228,                                // KEYCODE_PTT — Motorola/Zebra (raw int, API 28+)
        KeyEvent.KEYCODE_VOLUME_UP,         // 24  — budget PTT accessories
        // NOTE: KEYCODE_SPACE (62) was here but REMOVED — it breaks typing spaces
        // in all input fields since dispatchKeyEvent consumes it before the WebView.
        KeyEvent.KEYCODE_MEDIA_PAUSE,       // 164
        KeyEvent.KEYCODE_MEDIA_PLAY,        // 126
    };

    private boolean isPttKey(int keyCode) {
        for (int code : PTT_KEYCODES) {
            if (code == keyCode) return true;
        }
        return false;
    }

    /**
     * Called from MainActivity.dispatchKeyEvent when ACTION_DOWN fires.
     * Returns true if consumed (PTT key), false to pass through.
     */
    public boolean handleKeyDown(int keyCode) {
        if (!isPttKey(keyCode)) return false;
        JSObject data = new JSObject();
        data.put("keyCode", keyCode);
        data.put("state", "down");
        notifyListeners("pttDown", data);
        return true;
    }

    /**
     * Called from MainActivity.dispatchKeyEvent when ACTION_UP fires.
     */
    public boolean handleKeyUp(int keyCode) {
        if (!isPttKey(keyCode)) return false;
        JSObject data = new JSObject();
        data.put("keyCode", keyCode);
        data.put("state", "up");
        notifyListeners("pttUp", data);
        return true;
    }

    /**
     * JS-callable method: returns list of currently mapped keycodes.
     * Useful for the settings/debug screen.
     */
    @PluginMethod
    public void getMappedKeycodes(PluginCall call) {
        JSObject result = new JSObject();
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < PTT_KEYCODES.length; i++) {
            sb.append(PTT_KEYCODES[i]);
            if (i < PTT_KEYCODES.length - 1) sb.append(",");
        }
        sb.append("]");
        result.put("keycodes", sb.toString());
        call.resolve(result);
    }
}
