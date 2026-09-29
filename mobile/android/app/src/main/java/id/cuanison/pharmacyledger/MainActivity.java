package id.cuanison.pharmacyledger;

import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Longest the launch screen waits for the first page before giving way anyway. */
    private static final long SPLASH_MAX_MS = 2500;

    private static volatile boolean firstPageShown = false;

    static void markFirstPageShown() {
        firstPageShown = true;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The launch screen stays until the first page has drawn, so opening
        // the app goes straight from the capsule to a finished screen, never
        // through a blank WebView.
        final long started = SystemClock.uptimeMillis();
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(
            () -> !firstPageShown && SystemClock.uptimeMillis() - started < SPLASH_MAX_MS
        );

        // Registered before the bridge starts, so its load() runs before the
        // first page: a JavaScript interface added later only appears after a
        // reload, and the shell reads the clock on its very first line.
        registerPlugin(PharmacyNativePlugin.class);
        super.onCreate(savedInstanceState);

        fitPageBetweenSystemBars();
        getOnBackPressedDispatcher().addCallback(this, backButton);
    }

    /**
     * Android 15 draws every app edge to edge. The website was not written to
     * sit under the status bar -- and on WebViews older than 140 it cannot
     * even learn the insets -- so the page is padded clear of the bars and of
     * the keyboard here, the same on every phone. What shows through the
     * padding is the window background: the app's dark chrome.
     */
    private void fitPageBetweenSystemBars() {
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(false);

        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }

    /** Asks the app's page to close whatever is open on top; "true" if it did. */
    private static final String ASK_PAGE =
        "(function(){try{return !!(window.__pharmacyBack && window.__pharmacyBack());}catch(e){return false;}})()";

    /**
     * Back first closes whatever is open on top of the page -- the payment
     * sheet, the camera. Then it moves through the website's pages and the
     * app's own screens, but never from the website back into the app's
     * sign-in screen it came from -- that would look like being signed out.
     * At the start of either, the app goes to the background instead of
     * closing, as other apps do.
     */
    private final OnBackPressedCallback backButton = new OnBackPressedCallback(true) {
        @Override
        public void handleOnBackPressed() {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView == null) {
                moveTaskToBack(true);
                return;
            }
            webView.evaluateJavascript(ASK_PAGE, (handled) -> {
                if (!"true".equals(handled)) navigateBack(webView);
            });
        }
    };

    private void navigateBack(WebView webView) {
        WebBackForwardList history = webView.copyBackForwardList();
        int index = history.getCurrentIndex();
        if (index <= 0) {
            moveTaskToBack(true);
            return;
        }
        String here = NativeBridge.originOf(history.getItemAtIndex(index).getUrl());
        String previous = NativeBridge.originOf(history.getItemAtIndex(index - 1).getUrl());
        if (here != null && here.equals(previous)) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }
}
