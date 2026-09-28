package id.cuanison.pharmacyledger;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Not a plugin anyone calls. It exists because a plugin's load() runs after the
 * WebView is made and before the first page loads -- the one moment both the
 * JavaScript interface and the navigation rules must be installed.
 */
@CapacitorPlugin(name = "PharmacyNative")
public class PharmacyNativePlugin extends Plugin {

    @Override
    public void load() {
        NativeBridge nativeBridge = new NativeBridge(getContext(), getBridge().getWebView());
        LedgerWebViewClient client = new LedgerWebViewClient(getBridge(), nativeBridge);
        getBridge().setWebViewClient(client);
        getBridge().getWebView().addJavascriptInterface(nativeBridge, "PharmacyNative");
    }
}
