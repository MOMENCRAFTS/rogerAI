package com.rogerai.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import android.widget.RemoteViews;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * PttWidgetService — Headless voice assistant service for the PTT widget.
 *
 * Flow:
 *   1. Widget tap starts this foreground service
 *   2. Android SpeechRecognizer captures voice → transcription
 *   3. Transcription sent to Supabase process-transmission edge function
 *   4. AI response returned → Android TextToSpeech speaks it
 *   5. Service auto-stops, widget subtitle updates with last response
 *
 * No app launch required — true headless Roger from the home screen.
 */
public class PttWidgetService extends Service {

    private static final String TAG = "RogerPttService";
    private static final String CHANNEL_ID = "roger_ptt_channel";
    private static final int NOTIFICATION_ID = 9001;

    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        initTts();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Show foreground notification immediately
        startForeground(NOTIFICATION_ID, buildNotification("Listening..."));
        updateWidgetStatus("LISTENING...");

        // Start speech recognition
        startListening();

        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }

    // ── TTS Init ─────────────────────────────────────────────────────────────

    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.US);
                tts.setSpeechRate(1.05f);
                tts.setPitch(0.95f);
                ttsReady = true;
            } else {
                Log.e(TAG, "TTS init failed");
            }
        });
    }

    // ── Speech Recognition ───────────────────────────────────────────────────

    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Log.e(TAG, "Speech recognition not available");
            handleError("Speech recognition not available on this device.");
            return;
        }

        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                Log.d(TAG, "Ready for speech");
            }

            @Override public void onBeginningOfSpeech() {
                Log.d(TAG, "Speech started");
                updateNotification("Listening...");
            }

            @Override public void onRmsChanged(float rmsdB) { }
            @Override public void onBufferReceived(byte[] buffer) { }

            @Override public void onEndOfSpeech() {
                Log.d(TAG, "Speech ended");
                updateNotification("Processing...");
                updateWidgetStatus("PROCESSING...");
            }

            @Override
            public void onError(int error) {
                String msg;
                switch (error) {
                    case SpeechRecognizer.ERROR_NO_MATCH:
                        msg = "Didn't catch that. Try again.";
                        break;
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                        msg = "No speech detected. Over.";
                        break;
                    case SpeechRecognizer.ERROR_AUDIO:
                        msg = "Audio error. Check mic permissions.";
                        break;
                    default:
                        msg = "Recognition error (" + error + "). Over.";
                }
                handleError(msg);
            }

            @Override
            public void onResults(Bundle results) {
                java.util.ArrayList<String> matches =
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    String transcript = matches.get(0);
                    Log.d(TAG, "Transcript: " + transcript);
                    updateNotification("Roger is thinking...");
                    updateWidgetStatus("THINKING...");
                    processWithRoger(transcript);
                } else {
                    handleError("Didn't catch that. Over.");
                }
            }

            @Override public void onPartialResults(Bundle partialResults) { }
            @Override public void onEvent(int eventType, Bundle params) { }
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);

        recognizer.startListening(intent);
    }

    // ── Process with Roger AI ────────────────────────────────────────────────

    private void processWithRoger(String transcript) {
        new Thread(() -> {
            try {
                SharedPreferences prefs = WidgetDataService.getPrefs(this);
                String supabaseUrl = prefs.getString("roger_supabase_url", "");
                String supabaseAnon = prefs.getString("roger_supabase_anon", "");
                String userId = prefs.getString("roger_user_id", "");

                if (supabaseUrl.isEmpty() || supabaseAnon.isEmpty()) {
                    handleError("Open Roger AI first to configure. Over.");
                    return;
                }

                // Build request to process-transmission edge function
                JSONObject body = new JSONObject();
                body.put("transcript", transcript);
                body.put("userId", userId);
                body.put("history", new org.json.JSONArray());

                URL url = new URL(supabaseUrl + "/functions/v1/process-transmission");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + supabaseAnon);
                conn.setConnectTimeout(120000);
                conn.setReadTimeout(120000);
                conn.setDoOutput(true);

                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();

                int code = conn.getResponseCode();
                if (code != 200) {
                    handleError("Roger couldn't process that. Try again. Over.");
                    return;
                }

                // Read response
                java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                conn.disconnect();

                JSONObject result = new JSONObject(sb.toString());
                String rogerResponse = result.optString("roger_response", "");

                if (rogerResponse.isEmpty()) {
                    handleError("Roger returned empty. Over.");
                    return;
                }

                // Save response for widget display
                prefs.edit()
                    .putString("roger_last_response", rogerResponse)
                    .apply();

                // Update notification + widget
                updateNotification("Roger: " + truncate(rogerResponse, 40));
                updateWidgetStatus(truncate(rogerResponse, 40));

                // Speak the response
                speakResponse(rogerResponse);

            } catch (Exception e) {
                Log.e(TAG, "Process error: " + e.getMessage());
                handleError("Connection error. Over.");
            }
        }).start();
    }

    // ── TTS playback ─────────────────────────────────────────────────────────

    private void speakResponse(String text) {
        if (!ttsReady || tts == null) {
            Log.e(TAG, "TTS not ready, finishing");
            finish();
            return;
        }

        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String utteranceId) {
                updateWidgetStatus("SPEAKING...");
            }

            @Override public void onDone(String utteranceId) {
                // All done — update widget with last response and stop service
                SharedPreferences prefs = WidgetDataService.getPrefs(PttWidgetService.this);
                String lastResp = prefs.getString("roger_last_response", "Standing by. Over.");
                updateWidgetSubtitle(lastResp);
                updateWidgetStatus("TAP TO TALK");
                finish();
            }

            @Override public void onError(String utteranceId) {
                finish();
            }
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "roger_widget_response");
        }
    }

    // ── Error handling ───────────────────────────────────────────────────────

    private void handleError(String message) {
        Log.w(TAG, "Error: " + message);
        WidgetDataService.getPrefs(this).edit()
            .putString("roger_last_response", message)
            .apply();
        updateWidgetSubtitle(message);
        updateWidgetStatus("TAP TO TALK");
        finish();
    }

    private void finish() {
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    // ── Widget updates ───────────────────────────────────────────────────────

    private void updateWidgetSubtitle(String text) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        int[] ids = mgr.getAppWidgetIds(
            new ComponentName(this, PttWidgetProvider.class));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(getPackageName(), R.layout.widget_ptt);
            views.setTextViewText(R.id.ptt_subtitle, truncate(text, 40));
            mgr.partiallyUpdateAppWidget(id, views);
        }
    }

    private void updateWidgetStatus(String statusText) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        int[] ids = mgr.getAppWidgetIds(
            new ComponentName(this, PttWidgetProvider.class));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(getPackageName(), R.layout.widget_ptt);
            views.setTextViewText(R.id.ptt_status, statusText);
            mgr.partiallyUpdateAppWidget(id, views);
        }
    }

    // ── Notification ─────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Roger PTT", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Roger AI voice assistant");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent launchIntent = getPackageManager()
            .getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0,
            launchIntent, PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        return builder
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Roger AI")
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private String truncate(String text, int max) {
        if (text == null) return "";
        return text.length() <= max ? text : text.substring(0, max - 1) + "\u2026";
    }
}
