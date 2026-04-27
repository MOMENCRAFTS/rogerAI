package com.rogerai.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Log;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * PrayerWidgetProvider — Prayer Times home screen widget (4×2).
 *
 * Displays:
 *   - Next prayer name + countdown
 *   - All 5 prayer times grid with current/next highlighted
 *   - Qibla direction bearing
 *   - Hijri date
 *
 * Data: UmmahAPI (no auth required), cached daily in SharedPreferences.
 * Updates every 60 seconds via AlarmManager for countdown accuracy.
 */
public class PrayerWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "RogerPrayerWidget";
    private static final String ACTION_UPDATE = "com.rogerai.app.PRAYER_WIDGET_UPDATE";
    private static final long UPDATE_INTERVAL_MS = 60_000; // 60 seconds

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, manager, id);
        }
        scheduleNextUpdate(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_UPDATE.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(
                new ComponentName(context, PrayerWidgetProvider.class));
            for (int id : ids) {
                updateWidget(context, manager, id);
            }
        }
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        scheduleNextUpdate(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        cancelUpdates(context);
    }

    // ── Update widget view ───────────────────────────────────────────────────

    private void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_prayer);

        // Read config from SharedPreferences (synced from Capacitor WebView)
        SharedPreferences prefs = WidgetDataService.getPrefs(context);
        double lat = prefs.getFloat("roger_latitude", 24.71f);
        double lng = prefs.getFloat("roger_longitude", 46.78f);
        String method = prefs.getString("roger_prayer_method", "MuslimWorldLeague");

        // Fetch prayer times (cached daily)
        new Thread(() -> {
            try {
                JSONObject times = WidgetDataService.fetchPrayerTimes(context, lat, lng, method);
                if (times == null) return;

                // Next prayer computation
                String[] next = WidgetDataService.getNextPrayer(times);
                String nextName = next[0];
                String nextTime = next[1];
                int secsUntil = Integer.parseInt(next[2]);
                String currentPrayer = WidgetDataService.getCurrentPrayer(times);

                // Qibla
                int qibla = WidgetDataService.getQiblaDirection(lat, lng);
                String cardinal = WidgetDataService.bearingToCardinal(qibla);

                // Hijri date
                String hijri = WidgetDataService.fetchHijriDate(context);

                // ── Build RemoteViews ────────────────────────────────────────

                // Hero section
                views.setTextViewText(R.id.prayer_name, nextName);
                views.setTextViewText(R.id.prayer_time, nextTime);

                String countdownText = "in " + WidgetDataService.formatCountdown(secsUntil);
                if (currentPrayer != null) {
                    countdownText += " · " + currentPrayer + " time now";
                }
                views.setTextViewText(R.id.prayer_countdown, countdownText);

                // Prayer grid values
                views.setTextViewText(R.id.prayer_val_fajr, times.optString("Fajr", "—"));
                views.setTextViewText(R.id.prayer_val_dhuhr, times.optString("Dhuhr", "—"));
                views.setTextViewText(R.id.prayer_val_asr, times.optString("Asr", "—"));
                views.setTextViewText(R.id.prayer_val_maghrib, times.optString("Maghrib", "—"));
                views.setTextViewText(R.id.prayer_val_isha, times.optString("Isha", "—"));

                // Highlight next prayer cell
                int highlightResId = R.drawable.widget_prayer_highlight;
                int normalColor = 0xFF9a9785; // text_secondary
                int activeColor = 0xFFe8e5d8; // text_primary

                int[] cellIds = {
                    R.id.prayer_cell_fajr, R.id.prayer_cell_dhuhr, R.id.prayer_cell_asr,
                    R.id.prayer_cell_maghrib, R.id.prayer_cell_isha
                };
                int[] valIds = {
                    R.id.prayer_val_fajr, R.id.prayer_val_dhuhr, R.id.prayer_val_asr,
                    R.id.prayer_val_maghrib, R.id.prayer_val_isha
                };
                String[] names = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};

                for (int i = 0; i < names.length; i++) {
                    if (names[i].equals(nextName)) {
                        views.setInt(cellIds[i], "setBackgroundResource", highlightResId);
                        views.setTextColor(valIds[i], activeColor);
                    } else {
                        views.setInt(cellIds[i], "setBackgroundColor", 0x00000000);
                        views.setTextColor(valIds[i], normalColor);
                    }
                }

                // Qibla + Hijri
                views.setTextViewText(R.id.prayer_qibla, "↗ " + qibla + "° " + cardinal);
                views.setTextViewText(R.id.prayer_hijri, hijri);

                // Tap intent — open app to Salah tab
                Intent launchIntent = context.getPackageManager()
                    .getLaunchIntentForPackage(context.getPackageName());
                if (launchIntent != null) {
                    launchIntent.putExtra("roger_target_tab", "salah");
                    launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent pendingIntent = PendingIntent.getActivity(
                        context, 100, launchIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    views.setOnClickPendingIntent(R.id.widget_prayer_root, pendingIntent);
                }

                manager.updateAppWidget(widgetId, views);

            } catch (Exception e) {
                Log.e(TAG, "Widget update failed: " + e.getMessage());
            }
        }).start();
    }

    // ── AlarmManager scheduling for 60-second countdown updates ──────────────

    private void scheduleNextUpdate(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;

        Intent intent = new Intent(context, PrayerWidgetProvider.class);
        intent.setAction(ACTION_UPDATE);
        PendingIntent pending = PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        alarm.setRepeating(
            AlarmManager.ELAPSED_REALTIME,
            SystemClock.elapsedRealtime() + UPDATE_INTERVAL_MS,
            UPDATE_INTERVAL_MS,
            pending);
    }

    private void cancelUpdates(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;

        Intent intent = new Intent(context, PrayerWidgetProvider.class);
        intent.setAction(ACTION_UPDATE);
        PendingIntent pending = PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        alarm.cancel(pending);
    }
}
