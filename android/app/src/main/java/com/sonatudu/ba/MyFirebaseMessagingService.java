package com.sonatudu.ba;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.Map;

public class MyFirebaseMessagingService extends MessagingService {
    static final String POKE_CHANNEL = "ba_poke";
    private static final int POKE_ID = 71002;
    private static final long[] POKE_PATTERN = {0, 72, 48, 72, 48, 160, 56, 220};

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data != null && "poke".equals(data.get("kind"))) {
            vibratePoke();
        }
        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d("FCM", "Refreshed token: " + token);
    }

    static void ensurePokeChannel(NotificationManager manager) {
        if (manager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            POKE_CHANNEL,
            "Poke",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Vibration only");
        channel.enableVibration(true);
        channel.setVibrationPattern(POKE_PATTERN);
        channel.setSound(null, null);
        channel.enableLights(false);
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_SECRET);
        manager.createNotificationChannel(channel);
    }

    private void vibratePoke() {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = getSystemService(VibratorManager.class);
            vibrator = manager != null ? manager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        }
        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                vibrator.vibrate(
                    VibrationEffect.createWaveform(POKE_PATTERN, -1),
                    VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION)
                );
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(POKE_PATTERN, -1));
            } else {
                vibrator.vibrate(POKE_PATTERN, -1);
            }
        }

        NotificationManager notifications = getSystemService(NotificationManager.class);
        if (notifications == null) return;
        ensurePokeChannel(notifications);
        notifications.notify(
            POKE_ID,
            new NotificationCompat.Builder(this, POKE_CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Ba")
                .setContentText("\u200B")
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .setVibrate(POKE_PATTERN)
                .setSound(null)
                .setShowWhen(false)
                .setSilent(false)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setTimeoutAfter(120)
                .setAutoCancel(true)
                .build()
        );
        new Handler(Looper.getMainLooper()).postDelayed(() -> notifications.cancel(POKE_ID), 150);
    }
}
