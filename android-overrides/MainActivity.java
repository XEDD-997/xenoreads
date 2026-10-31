package com.xedd.xenoreads;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int DUSK = Color.parseColor("#11192C");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(DUSK);
        w.setNavigationBarColor(DUSK);
        preferHighestRefreshRate();
    }

    @Override
    public void onResume() {
        super.onResume();
        preferHighestRefreshRate();
    }

    /** Ask Android for the screen's fastest mode (90/120/144 Hz) at the current resolution. */
    private void preferHighestRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getDisplay() : getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode m : display.getSupportedModes()) {
            if (m.getPhysicalWidth() == current.getPhysicalWidth()
                    && m.getPhysicalHeight() == current.getPhysicalHeight()
                    && m.getRefreshRate() > best.getRefreshRate()) {
                best = m;
            }
        }
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.preferredDisplayModeId = best.getModeId();
        lp.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(lp);
    }
}
