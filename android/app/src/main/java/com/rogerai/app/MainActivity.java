package com.rogerai.app;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PttButtonPlugin pttPlugin = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the PTT Button plugin before super.onCreate
        registerPlugin(PttButtonPlugin.class);
        super.onCreate(savedInstanceState);
    }

    private PttButtonPlugin getPttPlugin() {
        if (pttPlugin == null && getBridge() != null && getBridge().getPlugin("PttButton") != null) {
            pttPlugin = (PttButtonPlugin) getBridge().getPlugin("PttButton").getInstance();
        }
        return pttPlugin;
    }

    /**
     * Intercept ALL key events before they reach the WebView.
     * Routes PTT keycodes to the native plugin, passes everything else through.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        PttButtonPlugin plugin = getPttPlugin();
        if (plugin == null) return super.dispatchKeyEvent(event);

        int action  = event.getAction();
        int keyCode = event.getKeyCode();

        if (action == KeyEvent.ACTION_DOWN) {
            if (plugin.handleKeyDown(keyCode)) return true;
        } else if (action == KeyEvent.ACTION_UP) {
            if (plugin.handleKeyUp(keyCode)) return true;
        }

        return super.dispatchKeyEvent(event);
    }
}
