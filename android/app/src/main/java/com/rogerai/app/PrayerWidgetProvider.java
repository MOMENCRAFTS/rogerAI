package com.rogerai.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.os.SystemClock;
import android.util.Log;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * PrayerWidgetProvider — Prayer Times home screen widget (4×2).
 *
 * Fixed approach:
 *   1. Immediately render cached data (or placeholders) synchronously
 *   2. Kick off async fetch in background
 *   3. On fetch complete, re-render with live data
 *   4. AlarmManager triggers updates every 60 seconds
 */
public class PrayerWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "RogerWidget";
    private static final String ACTION_UPDATE = "com.rogerai.app.PRAYER_WIDGET_UPDATE";
    private static final long UPDATE_INTERVAL_MS = 60_000;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        Log.d(TAG, "PrayerWidget onUpdate called for " + appWidgetIds.length + " widgets");
        for (int id : appWidgetIds) {
            // First: render immediately with cached/default data
            renderWidget(context, manager, id);
            // Then: fetch fresh data in background
            fetchAndUpdate(context, manager, id);
        }
        scheduleNextUpdate(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_UPDATE.equals(intent.getAction())) {
            Log.d(TAG, "PrayerWidget alarm tick");
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(
                new ComponentName(context, PrayerWidgetProvider.class));
            for (int id : ids) {
                renderWidget(context, manager, id);
                fetchAndUpdate(context, manager, id);
            }
        }
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        Log.d(TAG, "PrayerWidget enabled — scheduling updates");
        scheduleNextUpdate(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        cancelUpdates(context);
    }

    // ── Synchronous render from cache ────────────────────────────────────────

    private void renderWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_prayer);
        SharedPreferences prefs = WidgetDataService.getPrefs(context);

        // Read cached prayer times
        String todayKey = new java.text.SimpleDateFormat("yyyy-MM-dd",
            java.util.Locale.US).format(new java.util.Date());
        String cached = prefs.getString("prayer_cache_" + todayKey, null);

        if (cached != null) {
            try {
                JSONObject times = new JSONObject(cached);
                populateViews(context, views, times, prefs);
            } catch (Exception e) {
                Log.w(TAG, "Bad cache: " + e.getMessage());
                showPlaceholder(views);
            }
        } else {
            showPlaceholder(views);
        }

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
    }

    // ── Populate views from prayer times JSON ────────────────────────────────

    private void populateViews(Context context, RemoteViews views, JSONObject times,
                               SharedPreferences prefs) {
        // Next prayer computation
        String[] next = WidgetDataService.getNextPrayer(times);
        String nextName = next[0];
        String nextTime = next[1];
        int secsUntil = Integer.parseInt(next[2]);
        String currentPrayer = WidgetDataService.getCurrentPrayer(times);

        // Hero section
        views.setTextViewText(R.id.prayer_name, nextName);
        views.setTextViewText(R.id.prayer_time, nextTime);

        String countdownText = "in " + WidgetDataService.formatCountdown(secsUntil);
        if (currentPrayer != null) {
            countdownText += " \u00B7 " + currentPrayer + " time now";
        }
        views.setTextViewText(R.id.prayer_countdown, countdownText);

        // Prayer grid values
        views.setTextViewText(R.id.prayer_val_fajr, times.optString("Fajr", "\u2014"));
        views.setTextViewText(R.id.prayer_val_dhuhr, times.optString("Dhuhr", "\u2014"));
        views.setTextViewText(R.id.prayer_val_asr, times.optString("Asr", "\u2014"));
        views.setTextViewText(R.id.prayer_val_maghrib, times.optString("Maghrib", "\u2014"));
        views.setTextViewText(R.id.prayer_val_isha, times.optString("Isha", "\u2014"));

        // Highlight next prayer cell
        int highlightResId = R.drawable.widget_prayer_highlight;
        int normalColor = 0xFF9a9785;
        int activeColor = 0xFFe8e5d8;

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

        // Qibla
        double lat = prefs.getFloat("roger_latitude", 24.71f);
        double lng = prefs.getFloat("roger_longitude", 46.78f);
        int qibla = WidgetDataService.getQiblaDirection(lat, lng);
        String cardinal = WidgetDataService.bearingToCardinal(qibla);
        views.setTextViewText(R.id.prayer_qibla, "\u2197 " + qibla + "\u00B0 " + cardinal);

        // Hijri — from cache only (no network in sync render)
        String hijriCached = prefs.getString("hijri_" + new java.text.SimpleDateFormat(
            "yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date()), "");
        views.setTextViewText(R.id.prayer_hijri, hijriCached);
    }

    private void showPlaceholder(RemoteViews views) {
        views.setTextViewText(R.id.prayer_name, "Loading...");
        views.setTextViewText(R.id.prayer_time, "--:--");
        views.setTextViewText(R.id.prayer_countdown, "Open app to sync");
        views.setTextViewText(R.id.prayer_val_fajr, "--:--");
        views.setTextViewText(R.id.prayer_val_dhuhr, "--:--");
        views.setTextViewText(R.id.prayer_val_asr, "--:--");
        views.setTextViewText(R.id.prayer_val_maghrib, "--:--");
        views.setTextViewText(R.id.prayer_val_isha, "--:--");
        views.setTextViewText(R.id.prayer_qibla, "");
        views.setTextViewText(R.id.prayer_hijri, "");
    }

    // ── Async fetch + re-render ──────────────────────────────────────────────

    @SuppressWarnings("deprecation")
    private void fetchAndUpdate(Context context, AppWidgetManager manager, int widgetId) {
        SharedPreferences prefs = WidgetDataService.getPrefs(context);
        double lat = prefs.getFloat("roger_latitude", 24.71f);
        double lng = prefs.getFloat("roger_longitude", 46.78f);
        String method = prefs.getString("roger_prayer_method", "MuslimWorldLeague");

        new AsyncTask<Void, Void, Boolean>() {
            @Override
            protected Boolean doInBackground(Void... voids) {
                try {
                    Log.d(TAG, "Fetching prayer times for " + lat + "," + lng);
                    JSONObject times = WidgetDataService.fetchPrayerTimes(context, lat, lng, method);
                    if (times == null) {
                        Log.w(TAG, "fetchPrayerTimes returned null");
                        return false;
                    }
                    // Also fetch Hijri date
                    WidgetDataService.fetchHijriDate(context);
                    Log.d(TAG, "Prayer data fetched OK");
                    return true;
                } catch (Exception e) {
                    Log.e(TAG, "Fetch failed: " + e.getMessage());
                    return false;
                }
            }

            @Override
            protected void onPostExecute(Boolean success) {
                if (success) {
                    renderWidget(context, manager, widgetId);
                }
            }
        }.execute();
    }

    // ── AlarmManager ─────────────────────────────────────────────────────────

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
