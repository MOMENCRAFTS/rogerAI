package com.rogerai.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * WidgetDataService — Shared HTTP + cache utility for all Roger AI widgets.
 *
 * Handles:
 *   - UmmahAPI prayer times fetching
 *   - SharedPreferences caching with daily expiry
 *   - Qibla direction computation
 *   - Countdown formatting
 */
public class WidgetDataService {

    private static final String TAG = "RogerWidget";
    private static final String PREFS_NAME = "roger_widget_prefs";
    private static final String UMMAH_API = "https://ummahapi.com/api";

    // Kaaba coordinates for Qibla calculation
    private static final double KAABA_LAT = 21.4225;
    private static final double KAABA_LNG = 39.8262;

    // ── SharedPreferences access ─────────────────────────────────────────────

    public static SharedPreferences getPrefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    // ── HTTP GET helper ──────────────────────────────────────────────────────

    public static String httpGet(String urlStr) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(10000);

        int code = conn.getResponseCode();
        if (code != 200) {
            throw new Exception("HTTP " + code + " from " + urlStr);
        }

        BufferedReader reader = new BufferedReader(
            new InputStreamReader(conn.getInputStream())
        );
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        conn.disconnect();
        return sb.toString();
    }

    // ── Prayer Times ─────────────────────────────────────────────────────────

    /**
     * Fetch prayer times from UmmahAPI. Returns JSON with Fajr, Sunrise,
     * Dhuhr, Asr, Maghrib, Isha fields. Caches for the entire day.
     */
    public static JSONObject fetchPrayerTimes(Context ctx, double lat, double lng, String method) {
        SharedPreferences prefs = getPrefs(ctx);
        String todayKey = todayKey();
        String cacheKey = "prayer_cache_" + todayKey;
        String cached = prefs.getString(cacheKey, null);

        // Return cached if available
        if (cached != null) {
            try {
                return new JSONObject(cached);
            } catch (Exception e) {
                Log.w(TAG, "Bad prayer cache, re-fetching");
            }
        }

        // Fetch fresh
        try {
            String url = UMMAH_API + "/prayer-times?lat=" + lat + "&lng=" + lng + "&method=" + method;
            String response = httpGet(url);
            JSONObject json = new JSONObject(response);
            JSONObject data = json.getJSONObject("data");
            JSONObject times = data.getJSONObject("prayer_times");

            // Normalize to capitalised keys
            JSONObject result = new JSONObject();
            result.put("Fajr", times.optString("fajr", "—"));
            result.put("Sunrise", times.optString("sunrise", "—"));
            result.put("Dhuhr", times.optString("dhuhr", "—"));
            result.put("Asr", times.optString("asr", "—"));
            result.put("Maghrib", times.optString("maghrib", "—"));
            result.put("Isha", times.optString("isha", "—"));

            // Cache for today
            prefs.edit()
                .putString(cacheKey, result.toString())
                // Clean old caches
                .apply();

            return result;
        } catch (Exception e) {
            Log.e(TAG, "Failed to fetch prayer times: " + e.getMessage());
            return null;
        }
    }

    /**
     * Fetch Hijri date from UmmahAPI. Returns formatted string.
     */
    public static String fetchHijriDate(Context ctx) {
        SharedPreferences prefs = getPrefs(ctx);
        String cacheKey = "hijri_" + todayKey();
        String cached = prefs.getString(cacheKey, null);
        if (cached != null) return cached;

        try {
            String response = httpGet(UMMAH_API + "/today-hijri");
            JSONObject json = new JSONObject(response);
            JSONObject hijri = json.getJSONObject("data").getJSONObject("hijri");
            String formatted = hijri.getInt("day") + " " +
                hijri.getString("month_name") + " " +
                hijri.getInt("year") + " AH";
            prefs.edit().putString(cacheKey, formatted).apply();
            return formatted;
        } catch (Exception e) {
            Log.w(TAG, "Hijri fetch failed: " + e.getMessage());
            return "";
        }
    }

    // ── Next Prayer Computation ──────────────────────────────────────────────

    public static String[] getNextPrayer(JSONObject times) {
        if (times == null) return new String[]{"—", "—", "0"};

        String[] prayerOrder = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int nowSecs = cal.get(java.util.Calendar.HOUR_OF_DAY) * 3600
            + cal.get(java.util.Calendar.MINUTE) * 60
            + cal.get(java.util.Calendar.SECOND);

        for (String name : prayerOrder) {
            String timeStr = times.optString(name, "");
            if (timeStr.isEmpty() || timeStr.equals("—")) continue;
            int prayerSecs = parseTimeToSecs(timeStr);
            if (prayerSecs > nowSecs) {
                int diff = prayerSecs - nowSecs;
                return new String[]{name, timeStr, String.valueOf(diff)};
            }
        }

        // Past Isha → next is tomorrow's Fajr
        String fajrTime = times.optString("Fajr", "04:00");
        int fajrSecs = parseTimeToSecs(fajrTime);
        int diff = (86400 - nowSecs) + fajrSecs;
        return new String[]{"Fajr", fajrTime, String.valueOf(diff)};
    }

    /**
     * Returns the name of the currently active prayer (the one whose time has
     * passed but the next hasn't started yet).
     */
    public static String getCurrentPrayer(JSONObject times) {
        if (times == null) return null;

        String[] prayerOrder = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int nowSecs = cal.get(java.util.Calendar.HOUR_OF_DAY) * 3600
            + cal.get(java.util.Calendar.MINUTE) * 60
            + cal.get(java.util.Calendar.SECOND);

        String current = null;
        for (String name : prayerOrder) {
            String timeStr = times.optString(name, "");
            if (timeStr.isEmpty() || timeStr.equals("—")) continue;
            int prayerSecs = parseTimeToSecs(timeStr);
            if (nowSecs >= prayerSecs) {
                current = name;
            }
        }
        return current;
    }

    // ── Qibla Direction ──────────────────────────────────────────────────────

    public static int getQiblaDirection(double lat, double lng) {
        double phi1 = Math.toRadians(lat);
        double phi2 = Math.toRadians(KAABA_LAT);
        double dLambda = Math.toRadians(KAABA_LNG - lng);

        double x = Math.sin(dLambda) * Math.cos(phi2);
        double y = Math.cos(phi1) * Math.sin(phi2)
            - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

        double bearing = (Math.toDegrees(Math.atan2(x, y)) + 360) % 360;
        return (int) Math.round(bearing);
    }

    public static String bearingToCardinal(int bearing) {
        String[] dirs = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
        return dirs[Math.round(bearing / 45f) % 8];
    }

    // ── Formatting ───────────────────────────────────────────────────────────

    public static String formatCountdown(int totalSeconds) {
        int h = totalSeconds / 3600;
        int m = (totalSeconds % 3600) / 60;
        if (h > 0) return h + "h " + m + "m";
        if (m > 0) return m + "m";
        return totalSeconds + "s";
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static int parseTimeToSecs(String time) {
        try {
            String[] parts = time.split(":");
            return Integer.parseInt(parts[0]) * 3600 + Integer.parseInt(parts[1]) * 60;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String todayKey() {
        java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat(
            "yyyy-MM-dd", java.util.Locale.US);
        return sdf.format(new java.util.Date());
    }
}
