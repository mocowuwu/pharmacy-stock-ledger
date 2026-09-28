package id.cuanison.pharmacyledger;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * window.PharmacyNative: what the app's pages need from the phone and a
 * browser cannot give them.
 *
 *  - elapsedRealtime() and bootCount(): a clock the date setting cannot move,
 *    and a way to notice it restarted. The offline pass is measured on them.
 *  - Files written atomically (temp file, fsync, rename): a sale is on disk
 *    before its receipt is shown, and a phone that dies mid-write keeps the
 *    previous file whole.
 *  - Printing, which a WebView otherwise ignores.
 *
 * Only two origins may use the files: the app's own pages (https://localhost)
 * and the pharmacy server the app was set up with. The WebView loads nothing
 * else (LedgerWebViewClient sends other links to the browser), and this check
 * holds even if it somehow did.
 */
public class NativeBridge {

    static final String APP_ORIGIN = "https://localhost";
    private static final Pattern NAME = Pattern.compile("^[a-z]+\\.json$");
    private static final String PREFS = "pharmacy_native";
    private static final String KEY_SERVER = "server_origin";

    private final Context context;
    private final WebView webView;
    private final SharedPreferences prefs;
    /** Set on the UI thread by LedgerWebViewClient; interface calls arrive on another thread. */
    private volatile String currentOrigin = APP_ORIGIN;

    NativeBridge(Context context, WebView webView) {
        this.context = context.getApplicationContext();
        this.webView = webView;
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** `scheme://host[:port]` of a URL, lower-cased; null if it has none. */
    static String originOf(String url) {
        if (url == null) return null;
        Uri uri = Uri.parse(url);
        if (uri.getScheme() == null || uri.getHost() == null) return null;
        String origin = uri.getScheme().toLowerCase() + "://" + uri.getHost().toLowerCase();
        if (uri.getPort() != -1) origin += ":" + uri.getPort();
        return origin;
    }

    void pageStarted(String url) {
        String origin = originOf(url);
        if (origin != null) currentOrigin = origin;
    }

    String serverOrigin() {
        return prefs.getString(KEY_SERVER, null);
    }

    private boolean trusted() {
        String origin = currentOrigin;
        return APP_ORIGIN.equals(origin) || (origin != null && origin.equals(serverOrigin()));
    }

    private File fileFor(String name) {
        if (name == null || !NAME.matcher(name).matches()) return null;
        return new File(context.getFilesDir(), name);
    }

    @JavascriptInterface
    public long elapsedRealtime() {
        return SystemClock.elapsedRealtime();
    }

    @JavascriptInterface
    public int bootCount() {
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT);
        } catch (Settings.SettingNotFoundException e) {
            return -1;
        }
    }

    /** The app's first screen has drawn: the launch screen can give way. */
    @JavascriptInterface
    public void ready() {
        MainActivity.markFirstPageShown();
    }

    @JavascriptInterface
    public String appVersion() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public String readFile(String name) {
        if (!trusted()) return null;
        File file = fileFor(name);
        if (file == null || !file.exists()) return null;
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int read = 0;
            while (read < bytes.length) {
                int n = in.read(bytes, read, bytes.length - read);
                if (n < 0) break;
                read += n;
            }
            return new String(bytes, 0, read, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean writeFile(String name, String content) {
        if (!trusted() || content == null) return false;
        File file = fileFor(name);
        if (file == null) return false;
        File temp = new File(file.getParentFile(), name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
        } catch (IOException e) {
            temp.delete();
            return false;
        }
        // rename() replaces the target atomically on the same filesystem.
        return temp.renameTo(file);
    }

    @JavascriptInterface
    public boolean deleteFile(String name) {
        if (!trusted()) return false;
        File file = fileFor(name);
        return file != null && (!file.exists() || file.delete());
    }

    /** Only the app's own setup screen may say which server the WebView trusts. */
    @JavascriptInterface
    public boolean setServerOrigin(String origin) {
        if (!APP_ORIGIN.equals(currentOrigin)) return false;
        String normalised = originOf(origin);
        if (normalised == null || !(normalised.startsWith("https://") || normalised.startsWith("http://"))) return false;
        prefs.edit().putString(KEY_SERVER, normalised).apply();
        return true;
    }

    @JavascriptInterface
    public void print(final String jobName) {
        if (!trusted()) return;
        webView.post(() -> {
            PrintManager manager = (PrintManager) webView.getContext().getSystemService(Context.PRINT_SERVICE);
            if (manager == null) return;
            String job = (jobName == null || jobName.isEmpty()) ? "Apotek" : jobName;
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(job);
            manager.print(job, adapter, new PrintAttributes.Builder().build());
        });
    }
}
