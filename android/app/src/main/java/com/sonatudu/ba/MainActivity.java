package com.sonatudu.ba;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bypassWebViewCache();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "ba_push",
                "Ba",
                NotificationManager.IMPORTANCE_HIGH
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
        if (BuildConfig.DEBUG) {
            new Handler(Looper.getMainLooper()).postDelayed(this::loadDebugLiveUi, 250);
        }
    }

    private void bypassWebViewCache() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView web = getBridge().getWebView();
        web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.clearCache(true);
        web.clearHistory();
    }

    private void loadDebugLiveUi() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView web = getBridge().getWebView();
        String current = String.valueOf(web.getUrl());
        if (current.contains(":5173")) return;
        String local = BuildConfig.BA_LOCAL_LIVE_URL;
        String lan = BuildConfig.BA_LIVE_URL;
        String url = local != null && local.startsWith("http") ? local : lan;
        if (url == null || url.isEmpty()) url = "http://127.0.0.1:5173";
        web.loadUrl(url);
    }
}
