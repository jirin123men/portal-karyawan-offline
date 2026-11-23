package io.github.jirin123men.absenportal;

import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.GeolocationPermissions;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.net.Uri;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {

    private static final int CAMERA_REQUEST = 101;
    private static final int LOCATION_REQUEST = 102;

    private WebView webView;
    private PermissionRequest pendingCameraRequest;
    private GeolocationPermissions.Callback pendingLocationCallback;
    private String pendingLocationOrigin;

    private static final String HOME =
        "https://jirin123men.github.io/portal-karyawan-offline/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(
                WebView view, WebResourceRequest request
            ) {
                Uri uri = request.getUrl();
                String host = uri.getHost();

                if ("jirin123men.github.io".equalsIgnoreCase(host)) {
                    return false;
                }

                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    Uri origin = Uri.parse(request.getOrigin().toString());

                    if (!"https".equalsIgnoreCase(origin.getScheme())
                        || !"jirin123men.github.io".equalsIgnoreCase(origin.getHost())) {
                        request.deny();
                        return;
                    }

                    boolean wantsCamera = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            wantsCamera = true;
                        }
                    }

                    if (!wantsCamera) {
                        request.deny();
                        return;
                    }

                    if (ContextCompat.checkSelfPermission(
                        MainActivity.this, Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE
                        });
                    } else {
                        pendingCameraRequest = request;
                        ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[]{Manifest.permission.CAMERA},
                            CAMERA_REQUEST
                        );
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin, GeolocationPermissions.Callback callback
            ) {
                Uri uri = Uri.parse(origin);

                if (!"https".equalsIgnoreCase(uri.getScheme())
                    || !"jirin123men.github.io".equalsIgnoreCase(uri.getHost())) {
                    callback.invoke(origin, false, false);
                    return;
                }

                boolean fine = ContextCompat.checkSelfPermission(
                    MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED;

                boolean coarse = ContextCompat.checkSelfPermission(
                    MainActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED;

                if (fine || coarse) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingLocationOrigin = origin;
                    pendingLocationCallback = callback;
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        LOCATION_REQUEST
                    );
                }
            }
        });

        webView.loadUrl(HOME);
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode, String[] permissions, int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == CAMERA_REQUEST && pendingCameraRequest != null) {
            PermissionRequest request = pendingCameraRequest;
            pendingCameraRequest = null;

            if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE
                });
            } else {
                request.deny();
            }
        }

        if (requestCode == LOCATION_REQUEST && pendingLocationCallback != null) {
            boolean granted = false;

            for (int result : grantResults) {
                if (result == PackageManager.PERMISSION_GRANTED) {
                    granted = true;
                }
            }

            pendingLocationCallback.invoke(
                pendingLocationOrigin, granted, false
            );

            pendingLocationCallback = null;
            pendingLocationOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
