package com.rogerai.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * PttWidgetProvider — True headless Push-to-Talk widget (2×2).
 *
 * Tapping the widget starts PttWidgetService — a foreground service that:
 *   1. Captures voice via Android SpeechRecognizer
 *   2. Sends transcription to Supabase process-transmission
 *   3. Speaks the AI response via native TextToSpeech
 *   4. Auto-stops — all without opening the app
 *
 * Widget shows live status: TAP TO TALK → LISTENING → THINKING → SPEAKING
 */
public class PttWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, manager, id);
        }
    }

    private void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_ptt);

        // Read last response from SharedPreferences
        SharedPreferences prefs = WidgetDataService.getPrefs(context);
        String lastResponse = prefs.getString("roger_last_response", "Standing by. Over.");

        // Truncate to ~40 chars for widget display
        if (lastResponse.length() > 40) {
            lastResponse = lastResponse.substring(0, 37) + "\u2026";
        }
        views.setTextViewText(R.id.ptt_subtitle, lastResponse);
        views.setTextViewText(R.id.ptt_status, "TAP TO TALK");

        // Tap intent → start PttWidgetService (headless voice pipeline)
        Intent serviceIntent = new Intent(context, PttWidgetService.class);
        PendingIntent pendingIntent;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            pendingIntent = PendingIntent.getForegroundService(
                context, 200, serviceIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        } else {
            pendingIntent = PendingIntent.getService(
                context, 200, serviceIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        views.setOnClickPendingIntent(R.id.widget_ptt_root, pendingIntent);

        manager.updateAppWidget(widgetId, views);
    }
}
