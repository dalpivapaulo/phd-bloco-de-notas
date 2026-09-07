package io.github.dalpivapaulo.phdnotas;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class PHDAlarmReceiver extends BroadcastReceiver {

    // Canal novo para não herdar vibração/som de versões antigas.
    private static final String CHANNEL_ID = "phd_reminders_v2";

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pendingResult = goAsync();

        new Thread(() -> {
            String id = intent.getStringExtra("alarm_id");
            String text = intent.getStringExtra("alarm_text");
            boolean wakeScreen = intent.getBooleanExtra("wake_screen", false);

            if (id == null) id = "phd";
            if (text == null || text.trim().isEmpty()) text = "Lembrete do PHD";

            if (wakeScreen) {
                wakeScreen(context);
            }

            showNotification(context, id, text);
            playThreeSecondBeep(context);

            PHDAlarmScheduler.removeStored(context, id);
            pendingResult.finish();
        }).start();
    }

    private void playThreeSecondBeep(Context context) {
        MediaPlayer player = null;
        AssetFileDescriptor afd = null;

        try {
            afd = context.getResources().openRawResourceFd(R.raw.phd_alert);
            if (afd == null) return;

            player = new MediaPlayer();
            player.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
            );
            player.setDataSource(
                    afd.getFileDescriptor(),
                    afd.getStartOffset(),
                    afd.getLength()
            );
            player.setLooping(false);
            player.prepare();
            player.start();

            long limit = System.currentTimeMillis() + 3500L;
            while (player.isPlaying() && System.currentTimeMillis() < limit) {
                try {
                    Thread.sleep(80L);
                } catch (InterruptedException ignored) {
                    break;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (player != null) {
                try {
                    player.stop();
                } catch (Exception ignored) {
                }
                try {
                    player.release();
                } catch (Exception ignored) {
                }
            }
            if (afd != null) {
                try {
                    afd.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void wakeScreen(Context context) {
        try {
            PowerManager powerManager =
                    (PowerManager) context.getSystemService(Context.POWER_SERVICE);

            if (powerManager == null) return;

            PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                            | PowerManager.ACQUIRE_CAUSES_WAKEUP
                            | PowerManager.ON_AFTER_RELEASE,
                    "PHDNotas:ReminderWake"
            );

            wakeLock.acquire(5000L);
        } catch (Exception ignored) {
        }
    }

    private void showNotification(Context context, String id, String text) {
        createChannel(context);

        Intent openApp = new Intent(context, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                Math.abs(id.hashCode()),
                openApp,
                pendingFlags
        );

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(context, CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.ic_popup_reminder)
                        .setContentTitle("PHD | Lembrete")
                        .setContentText(text)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setCategory(NotificationCompat.CATEGORY_REMINDER)
                        .setAutoCancel(true)
                        .setSilent(true)
                        .setContentIntent(contentIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        try {
            NotificationManagerCompat.from(context)
                    .notify(id.hashCode() & 0x7fffffff, builder.build());
        } catch (Exception ignored) {
        }
    }

    private void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Lembretes PHD",
                NotificationManager.IMPORTANCE_HIGH
        );

        channel.setDescription("Avisos locais dos lembretes do PHD Bloco de Notas");
        channel.enableVibration(false);
        channel.setVibrationPattern(null);
        channel.setSound(null, null);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);

        manager.createNotificationChannel(channel);
    }
}
