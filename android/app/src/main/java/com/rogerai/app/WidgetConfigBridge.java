package com.rogerai.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * WidgetConfigBridge — Capacitor plugin that syncs user config
 * from the web layer into SharedPreferences for widget consumption.
 *
 * Called from widgetBridge.ts whenever user prefs, location, or
 * task/reminder data changes.
 */
@CapacitorPlugin(name = "WidgetConfig")
public class WidgetConfigBridge extends Plugin {

    @PluginMethod
    public void syncConfig(PluginCall call) {
        SharedPreferences.Editor editor = WidgetDataService.getPrefs(getContext()).edit();

        if (call.hasOption("userId"))
            editor.putString("roger_user_id", call.getString("userId"));
        if (call.hasOption("islamicMode"))
            editor.putBoolean("roger_islamic_mode", call.getBoolean("islamicMode", false));
        if (call.hasOption("latitude"))
            editor.putFloat("roger_latitude", call.getFloat("latitude", 24.71f));
        if (call.hasOption("longitude"))
            editor.putFloat("roger_longitude", call.getFloat("longitude", 46.78f));
        if (call.hasOption("prayerMethod"))
            editor.putString("roger_prayer_method", call.getString("prayerMethod", "MuslimWorldLeague"));
        if (call.hasOption("taskCount"))
            editor.putInt("roger_task_count", call.getInt("taskCount", 0));
        if (call.hasOption("reminderCount"))
            editor.putInt("roger_reminder_count", call.getInt("reminderCount", 0));
        if (call.hasOption("nextDueText"))
            editor.putString("roger_next_due_text", call.getString("nextDueText", ""));
        if (call.hasOption("nextDueMs"))
            editor.putLong("roger_next_due_ms", (long) call.getDouble("nextDueMs", 0.0).doubleValue());
        if (call.hasOption("lastResponse"))
            editor.putString("roger_last_response", call.getString("lastResponse", "Standing by. Over."));
        if (call.hasOption("supabaseUrl"))
            editor.putString("roger_supabase_url", call.getString("supabaseUrl", ""));
        if (call.hasOption("supabaseAnon"))
            editor.putString("roger_supabase_anon", call.getString("supabaseAnon", ""));

        editor.apply();

        // Trigger widget updates
        AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());

        int[] prayerIds = mgr.getAppWidgetIds(
            new ComponentName(getContext(), PrayerWidgetProvider.class));
        if (prayerIds.length > 0) {
            new PrayerWidgetProvider().onUpdate(getContext(), mgr, prayerIds);
        }

        int[] pttIds = mgr.getAppWidgetIds(
            new ComponentName(getContext(), PttWidgetProvider.class));
        if (pttIds.length > 0) {
            new PttWidgetProvider().onUpdate(getContext(), mgr, pttIds);
        }

        int[] taskIds = mgr.getAppWidgetIds(
            new ComponentName(getContext(), TasksWidgetProvider.class));
        if (taskIds.length > 0) {
            new TasksWidgetProvider().onUpdate(getContext(), mgr, taskIds);
        }

        call.resolve();
    }
}
