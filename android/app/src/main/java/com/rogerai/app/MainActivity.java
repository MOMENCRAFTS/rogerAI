package com.rogerai.app;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PttButtonPlugin pttPlugin = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the PTT Button plugin before super.onCreate
        registerPlugin(PttButtonPlugin.class);
        // Register the Widget Config Bridge plugin for home screen widgets
        registerPlugin(WidgetConfigBridge.class);
        super.onCreate(savedInstanceState);

        // ── Audio unlock: must be applied in onCreate(), BEFORE any web content loads.
        // If applied in onStart() (too late), Android WebView may have already enforced
        // autoplay blocking, causing Roger's TTS to be completely silent on device.
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        // Allow HTMLAudioElement.play() without a prior user gesture.
        // This is the primary fix for TTS silence on Android WebView.
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Allow blob: URLs created by URL.createObjectURL() to be played back.
        // Without these flags, the TTS audio blob URL is blocked by WebView's
        // file:// sandbox — the audio element is created but plays nothing.
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // Required for AudioContext / Web Audio API state persistence
        settings.setDomStorageEnabled(true);
    }

    @Override
    public void onStart() {
        super.onStart();
        // Audio flags moved to onCreate() above — must be set before web content loads.
        // Keeping onStart() for any future lifecycle hooks.
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
