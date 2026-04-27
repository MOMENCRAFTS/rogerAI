package com.rogerai.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * TasksWidgetProvider — Tasks & Reminders compact bar widget (4×1).
 * Reads cached counts from SharedPreferences (populated by web app).
 */
public class TasksWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, manager, id);
        }
    }

    private void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        SharedPreferences prefs = WidgetDataService.getPrefs(context);

        int taskCount = prefs.getInt("roger_task_count", 0);
        int reminderCount = prefs.getInt("roger_reminder_count", 0);
        String nextDueText = prefs.getString("roger_next_due_text", "");
        long nextDueMs = prefs.getLong("roger_next_due_ms", 0);

        views.setTextViewText(R.id.tasks_count, String.valueOf(taskCount));
        views.setTextViewText(R.id.reminders_count, String.valueOf(reminderCount));

        if (nextDueText != null && !nextDueText.isEmpty()) {
            String dueDisplay;
            if (nextDueMs > 0) {
                long msUntil = nextDueMs - System.currentTimeMillis();
                if (msUntil > 0) {
                    int secsUntil = (int) (msUntil / 1000);
                    dueDisplay = "\u23F1 " + truncate(nextDueText, 25) + " \u2014 in " +
                        WidgetDataService.formatCountdown(secsUntil);
                } else {
                    dueDisplay = "\u23F1 " + truncate(nextDueText, 25) + " \u2014 overdue";
                }
            } else {
                dueDisplay = "\u23F1 " + truncate(nextDueText, 30);
            }
            views.setTextViewText(R.id.tasks_next_due, dueDisplay);
        } else if (taskCount == 0 && reminderCount == 0) {
            views.setTextViewText(R.id.tasks_next_due, "All clear. Over.");
        } else {
            views.setTextViewText(R.id.tasks_next_due, "");
        }

        Intent launchIntent = context.getPackageManager()
            .getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            launchIntent.putExtra("roger_target_tab", "tasks");
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 300, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_tasks_root, pendingIntent);
        }

        manager.updateAppWidget(widgetId, views);
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return "";
        if (text.length() <= maxLen) return text;
        return text.substring(0, maxLen - 1) + "\u2026";
    }
}
