package io.github.dalpivapaulo.phdnotas;

import android.Manifest;
import android.app.AlarmManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
        name = "PHDAlarm",
        permissions = {
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class PHDAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
            return;
        }

        scheduleInternal(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        scheduleInternal(call);
    }

    private void scheduleInternal(PluginCall call) {
        String id = call.getString("id");
        String text = call.getString("text", "Lembrete do PHD");
        Double whenValue = call.getDouble("whenMs");
        Boolean wakeValue = call.getBoolean("wakeScreen", false);

        if (id == null || id.trim().isEmpty()) {
            call.reject("ID do lembrete ausente.");
            return;
        }

        if (whenValue == null) {
            call.reject("Data/hora do lembrete ausente.");
            return;
        }

        long whenMs = whenValue.longValue();
        if (whenMs <= System.currentTimeMillis()) {
            call.reject("O horário do lembrete já passou.");
            return;
        }

        boolean exact = PHDAlarmScheduler.schedule(
                getContext(),
                id,
                text,
                whenMs,
                Boolean.TRUE.equals(wakeValue)
        );

        JSObject result = new JSObject();
        result.put("scheduled", true);
        result.put("exact", exact);
        result.put("needsExactPermission", !exact);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");

        if (id == null || id.trim().isEmpty()) {
            call.reject("ID do lembrete ausente.");
            return;
        }

        PHDAlarmScheduler.cancel(getContext(), id);

        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void canScheduleExact(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", PHDAlarmScheduler.canScheduleExact(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void requestExactAlarmAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && !PHDAlarmScheduler.canScheduleExact(getContext())) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:" + getContext().getPackageName())
                );
                getActivity().startActivity(intent);
            } catch (Exception ignored) {
                Intent intent = new Intent(Settings.ACTION_SETTINGS);
                getActivity().startActivity(intent);
            }
        }

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }
}
