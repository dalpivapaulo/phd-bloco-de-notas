package io.github.dalpivapaulo.phdnotas;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.util.Map;

public final class PHDAlarmScheduler {

    private static final String PREFS = "phd_alarm_store";
    private static final String PREFIX = "alarm_";
    private static final String ACTION = "io.github.dalpivapaulo.phdnotas.PHD_ALARM";

    private PHDAlarmScheduler() {}

    public static boolean schedule(Context context, String id, String text, long whenMs, boolean wakeScreen) {
        return scheduleInternal(context, id, text, whenMs, wakeScreen, true);
    }

    private static boolean scheduleInternal(
            Context context,
            String id,
            String text,
            long whenMs,
            boolean wakeScreen,
            boolean persist
    ) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return false;

        PendingIntent alarmIntent = pendingIntent(context, id, text, whenMs, wakeScreen);

        boolean exact = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (alarmManager.canScheduleExactAlarms()) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenMs, alarmIntent);
            } else {
                exact = false;
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenMs, alarmIntent);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenMs, alarmIntent);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, whenMs, alarmIntent);
        }

        if (persist) save(context, id, text, whenMs, wakeScreen);
        return exact;
    }

    public static void cancel(Context context, String id) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.cancel(pendingIntent(context, id, "", 0L, false));
        }
        removeStored(context, id);
    }

    public static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarmManager != null && alarmManager.canScheduleExactAlarms();
    }

    public static void rescheduleAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Map<String, ?> all = prefs.getAll();
        long now = System.currentTimeMillis();

        for (Map.Entry<String, ?> entry : all.entrySet()) {
            if (!entry.getKey().startsWith(PREFIX)) continue;
            try {
                JSONObject obj = new JSONObject(String.valueOf(entry.getValue()));
                String id = obj.getString("id");
                String text = obj.optString("text", "Lembrete");
                long whenMs = obj.getLong("whenMs");
                boolean wakeScreen = obj.optBoolean("wakeScreen", false);

                if (whenMs <= now) {
                    removeStored(context, id);
                    continue;
                }

                scheduleInternal(context, id, text, whenMs, wakeScreen, false);
            } catch (Exception ignored) {
            }
        }
    }

    public static void removeStored(Context context, String id) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(PREFIX + id)
                .apply();
    }

    private static PendingIntent pendingIntent(
            Context context,
            String id,
            String text,
            long whenMs,
            boolean wakeScreen
    ) {
        Intent intent = new Intent(context, PHDAlarmReceiver.class);
        intent.setAction(ACTION);
        intent.setData(Uri.parse("phd://alarm/" + Uri.encode(id)));
        intent.putExtra("alarm_id", id);
        intent.putExtra("alarm_text", text);
        intent.putExtra("alarm_when", whenMs);
        intent.putExtra("wake_screen", wakeScreen);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }

    private static void save(Context context, String id, String text, long whenMs, boolean wakeScreen) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("id", id);
            obj.put("text", text);
            obj.put("whenMs", whenMs);
            obj.put("wakeScreen", wakeScreen);

            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(PREFIX + id, obj.toString())
                    .apply();
        } catch (Exception ignored) {
        }
    }
}
