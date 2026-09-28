package id.cuanison.pharmacyledger;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge starts, so its load() runs before the
        // first page: a JavaScript interface added later only appears after a
        // reload, and the shell reads the clock on its very first line.
        registerPlugin(PharmacyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
