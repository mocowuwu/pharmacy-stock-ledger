package id.cuanison.pharmacyledger;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.widget.Toast;
import androidx.core.content.ContextCompat;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Downloads started from a page: a report's CSV or Excel file, or the app
 * itself when it is updated from Settings -> Aplikasi Android.
 *
 * A WebView drops downloads on the floor unless someone takes them, so they
 * go to Android's download manager with the page's session cookie -- the
 * website serves both only to someone signed in. Finished files open at once:
 * a spreadsheet in whatever reads spreadsheets, an APK in the installer.
 *
 * Files land in the app's own Downloads folder, which needs no storage
 * permission on any Android version; the download notification still lists
 * them.
 */
final class AppDownloads implements DownloadListener {

    private static final String APK = "application/vnd.android.package-archive";

    private final Activity activity;
    private final DownloadManager manager;
    private final Set<Long> pending = Collections.synchronizedSet(new HashSet<>());

    private final BroadcastReceiver finished = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (!pending.remove(id)) return;
            open(id);
        }
    };

    AppDownloads(Activity activity) {
        this.activity = activity;
        this.manager = activity.getSystemService(DownloadManager.class);
        ContextCompat.registerReceiver(
            activity.getApplicationContext(),
            finished,
            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED
        );
    }

    @Override
    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long length) {
        if (manager == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) request.addRequestHeader("Cookie", cookies);
        request.addRequestHeader("User-Agent", userAgent);
        if (mimeType != null) request.setMimeType(mimeType);
        request.setTitle(name);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name);
        pending.add(manager.enqueue(request));
        Toast.makeText(activity, activity.getString(R.string.download_started, name), Toast.LENGTH_SHORT).show();
    }

    private void open(long id) {
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                Toast.makeText(activity, R.string.download_failed, Toast.LENGTH_LONG).show();
                return;
            }
        }
        Uri uri = manager.getUriForDownloadedFile(id);
        String type = manager.getMimeTypeForDownloadedFile(id);
        if (uri == null) return;
        Intent view = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, type != null ? type : APK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(view);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(activity, R.string.download_no_viewer, Toast.LENGTH_LONG).show();
        }
    }
}
