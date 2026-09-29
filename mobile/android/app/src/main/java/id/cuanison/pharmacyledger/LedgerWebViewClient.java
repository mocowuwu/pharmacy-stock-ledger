package id.cuanison.pharmacyledger;

import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Where the WebView may go, and what happens when the server is gone.
 *
 * The pharmacy server's address is only known after setup, so it cannot sit
 * in Capacitor's static allowNavigation list -- and a wildcard there would
 * route the website through Capacitor's own proxy. Instead the one origin the
 * setup screen saved stays in the WebView; the app's own pages are Capacitor's
 * as usual; anything else opens in the phone's browser.
 *
 * A server page that cannot load -- no connection, or a gateway error, which is
 * what Tailscale Serve answers when the pharmacy server behind it is stopped --
 * sends the person to the app's offline screen instead of Chrome's error page.
 * An ordinary 404 or 500 from the website is left alone: that is the website
 * talking, not the server being down.
 */
public class LedgerWebViewClient extends BridgeWebViewClient {

    private static final String OFFLINE_URL = NativeBridge.APP_ORIGIN + "/#/offline?reason=unreachable";
    private final NativeBridge nativeBridge;

    LedgerWebViewClient(Bridge bridge, NativeBridge nativeBridge) {
        super(bridge);
        this.nativeBridge = nativeBridge;
    }

    private boolean isServer(Uri url) {
        String server = nativeBridge.serverOrigin();
        return server != null && server.equals(NativeBridge.originOf(url.toString()));
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (isServer(request.getUrl())) return false;
        return super.shouldOverrideUrlLoading(view, request);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        nativeBridge.pageStarted(url);
        super.onPageStarted(view, url, favicon);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request.isForMainFrame() && isServer(request.getUrl())) view.loadUrl(OFFLINE_URL);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        super.onReceivedHttpError(view, request, response);
        int status = response.getStatusCode();
        boolean gateway = status == 502 || status == 503 || status == 504;
        if (gateway && request.isForMainFrame() && isServer(request.getUrl())) view.loadUrl(OFFLINE_URL);
    }
}
