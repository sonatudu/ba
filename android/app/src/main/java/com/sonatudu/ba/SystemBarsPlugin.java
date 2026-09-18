package com.sonatudu.ba;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {
    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean day = Boolean.TRUE.equals(call.getBoolean("day", false));
        getActivity().runOnUiThread(() -> {
            MainActivity.paintBars(getActivity(), day);
            call.resolve();
        });
    }
}
