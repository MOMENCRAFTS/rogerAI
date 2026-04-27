package com.rogerai.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * PttWidgetProvider — Push-to-Talk quick-launch widget (2×2).
 *
 * A static widget that shows the RogerAI mic button. Tapping it
 * launches the main app directly to the PTT home screen.
 * Subtitle shows the last Roger response snippet from cache.
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
            lastResponse = lastResponse.substring(0, 37) + "…";
        }
        views.setTextViewText(R.id.ptt_subtitle, lastResponse);

        // Tap intent — launch app to home/PTT
        Intent launchIntent = context.getPackageManager()
            .getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            launchIntent.putExtra("roger_target_tab", "home");
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 200, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_ptt_root, pendingIntent);
        }

        manager.updateAppWidget(widgetId, views);
    }
}
