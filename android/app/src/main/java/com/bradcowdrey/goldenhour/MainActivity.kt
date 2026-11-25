package com.bradcowdrey.goldenhour

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.CalendarContract
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

/**
 * Golden Hour for Android, first cut: the web app in a full-screen web view, so the app is the same one
 * the site serves. The site's service worker keeps it working offline once it has been opened. Links that
 * leave the site (maps, directions, messages, GitHub) open in their own apps; Back goes back a step;
 * Share and Add to calendar use Android's own sheets through a small bridge.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var geoOrigin: String? = null
    private var geoCallback: GeolocationPermissions.Callback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ink = Color.rgb(0x1A, 0x18, 0x16)
        val root = FrameLayout(this)
        root.setBackgroundColor(ink)
        web = WebView(this)
        web.setBackgroundColor(ink)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // Keep the page clear of the status bar, the navigation bar, a display cutout and the keyboard.
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        val settings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setGeolocationEnabled(true)
        settings.setSupportMultipleWindows(false)
        web.addJavascriptInterface(Bridge(), "GoldenHourAndroid")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (isOurs(url)) return false
                open(Intent(Intent.ACTION_VIEW, url))
                return true
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request != null && request.isForMainFrame) view?.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback?.invoke(origin, true, false)
                } else {
                    geoOrigin = origin
                    geoCallback = callback
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION), LOCATION_REQUEST)
                }
            }
        }

        if (savedInstanceState == null) web.loadUrl(HOME) else web.restoreState(savedInstanceState)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCATION_REQUEST) return
        val granted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
        geoCallback?.invoke(geoOrigin, granted, false)
        geoCallback = null
        geoOrigin = null
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun isOurs(url: Uri): Boolean {
        val scheme = url.scheme?.lowercase() ?: return false
        if (scheme == "about" || scheme == "blob" || scheme == "data") return true
        return (scheme == "https" || scheme == "http") && url.host?.lowercase() == HOST
    }

    private fun open(intent: Intent) {
        try { startActivity(intent) } catch (e: Exception) { /* nothing on this phone opens it */ }
    }

    /** What the page can ask Android for: the share sheet, and Calendar's new-event screen. */
    inner class Bridge {
        @JavascriptInterface
        fun share(title: String?, text: String?) {
            runOnUiThread {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, title ?: "Golden Hour")
                    .putExtra(Intent.EXTRA_TEXT, text ?: "")
                open(Intent.createChooser(send, null))
            }
        }

        @JavascriptInterface
        fun calendar(json: String?) {
            runOnUiThread {
                try {
                    val o = JSONObject(json ?: "{}")
                    open(Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, o.getLong("start"))
                        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, o.getLong("end"))
                        .putExtra(CalendarContract.Events.TITLE, o.optString("title", "Sunset"))
                        .putExtra(CalendarContract.Events.EVENT_LOCATION, o.optString("location"))
                        .putExtra(CalendarContract.Events.DESCRIPTION, o.optString("notes")))
                } catch (e: Exception) { /* a malformed request adds nothing */ }
            }
        }
    }

    companion object {
        private const val HOST = "bradleycowdrey.github.io"
        private const val HOME = "https://bradleycowdrey.github.io/golden-hour/"
        private const val LOCATION_REQUEST = 1
        private const val OFFLINE = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>" +
            "<body style='margin:0;background:#1A1816;color:#fff;font:17px system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center'>" +
            "<div style='padding:24px'><p style='font-size:20px;font-weight:500;margin:0 0 8px'>Can’t reach Golden Hour</p><p style='opacity:.8;margin:0 0 20px'>Check the connection and try again.</p>" +
            "<a href='https://bradleycowdrey.github.io/golden-hour/' style='display:inline-block;padding:12px 22px;border-radius:999px;background:#F4B860;color:#2A1B05;font-weight:600;text-decoration:none'>Try again</a></div>"
    }
}
