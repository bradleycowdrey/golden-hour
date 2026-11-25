package com.bradcowdrey.goldenhour

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.CalendarContract
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.view.updateLayoutParams
import androidx.core.view.updatePadding
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import kotlin.math.max

/**
 * Golden Hour for Android, first cut, the same as the iPhone app: the web app in a full-screen web view,
 * loading the published site, whose service worker keeps it working offline once it has been opened.
 *
 * - The page sits between the status and navigation bars, which take its colours (assets/bridge.js).
 * - Back goes back a step in the page (its sheets and screens) before it leaves the app.
 * - Links that leave the site (Google Maps, directions, GitHub, messages, calls) open in their own apps.
 * - "Use my location" asks Android for approximate location the first time the page wants it.
 * - Share opens Android's share sheet with the page's picture; Add to calendar opens the calendar app's own
 *   new-event screen, filled in (the calendar's usual reminder applies).
 * - When the site can't be reached and nothing is saved yet, it says so, with Try again.
 */
class MainActivity : ComponentActivity() {
    private lateinit var root: View
    private lateinit var web: WebView
    private lateinit var statusBar: View
    private lateinit var navigationBar: View
    private lateinit var offline: View
    private var webGone = false
    private var loadFailed = false
    private var bridgeScript: String? = null
    private var locationAsk: Pair<String, GeolocationPermissions.Callback>? = null

    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        locationAsk?.let { (origin, callback) -> callback.invoke(origin, granted, false) }
        locationAsk = null
    }

    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            if (!webGone && web.canGoBack()) web.goBack()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        statusBar = findViewById(R.id.status_bar)
        navigationBar = findViewById(R.id.navigation_bar)
        offline = findViewById(R.id.offline)
        findViewById<View>(R.id.retry).setOnClickListener { retry() }
        fitBetweenBars()
        setUpWeb()
        onBackPressedDispatcher.addCallback(this, back)
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(Site.HOME)
    }

    /** Android 15 and later draw every app edge to edge: the page goes between the bars (and above the
     *  keyboard), and the bars behind it are painted in the page's colours. */
    private fun fitBetweenBars() {
        val pad = (24 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            web.updateLayoutParams<ViewGroup.MarginLayoutParams> {
                setMargins(bars.left, bars.top, bars.right, max(bars.bottom, keyboard.bottom))
            }
            statusBar.updateLayoutParams { height = bars.top }
            navigationBar.updateLayoutParams { height = bars.bottom }
            offline.updatePadding(left = bars.left + pad, top = bars.top + pad, right = bars.right + pad, bottom = bars.bottom + pad)
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWeb() {
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        web.setBackgroundColor(Site.INK)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
        }
        // The page's messages, accepted only from the Golden Hour site's own page (not from any frame in it).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "GoldenHourAndroid", setOf(Site.ORIGIN)) { _, message, origin, isMainFrame, _ ->
                if (isMainFrame && Site.isOurOrigin(origin.toString())) onPageMessage(message.data)
            }
            val hasCalendar = calendarIntent().resolveActivity(packageManager) != null
            val script = assets.open("bridge.js").bufferedReader().use { it.readText() }
                .replace("__HAS_CALENDAR__", hasCalendar.toString())
            bridgeScript = script
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(web, script, setOf(Site.ORIGIN))
            }
        }
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, _, _, _ -> if (url.startsWith("https:")) openOutside(Uri.parse(url)) }
    }

    private fun retry() {
        offline.isVisible = false
        val url = web.url
        if (url == null || url.startsWith("about:") || !Site.isOurs(url)) web.loadUrl(Site.HOME) else web.reload()
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (Site.isOurs(request.url.toString())) return false
            if (request.isForMainFrame) openOutside(request.url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            loadFailed = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                loadFailed = true
                offline.isVisible = true
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!loadFailed) offline.isVisible = false
            // Where the script couldn't run before the page's own (an older WebView), it runs now; it only
            // ever sets itself up once per page.
            val script = bridgeScript
            if (script != null && !loadFailed && url != null && url.startsWith("https:") && Site.isOurs(url)) view.evaluateJavascript(script, null)
            back.isEnabled = view.canGoBack()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            back.isEnabled = view.canGoBack()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The page stopped (out of memory, or it crashed): start the screen again rather than the app.
            webGone = true
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (!Site.isOurOrigin(origin)) {
                callback.invoke(origin, false, false)
                return
            }
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false)
                return
            }
            locationAsk?.let { (o, c) -> c.invoke(o, false, false) }
            locationAsk = origin to callback
            askLocation.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }

        override fun onGeolocationPermissionsHidePrompt() {
            locationAsk = null
        }
    }

    // ---------- What the page asks of the phone (assets/bridge.js) ----------

    private fun onPageMessage(data: String?) {
        val message = runCatching { JSONObject(data ?: return) }.getOrNull() ?: return
        when (message.optString("type")) {
            "calendar" -> addToCalendar(message)
            "share" -> share(message)
            "bars" -> paintBars(Site.colour(message.optString("top")), Site.colour(message.optString("bottom")))
        }
    }

    private fun calendarIntent() =
        Intent(Intent.ACTION_INSERT).setDataAndType(CalendarContract.Events.CONTENT_URI, "vnd.android.cursor.dir/event")

    /** The plan as a new event in the calendar app, for the person to check and save. No calendar permission. */
    private fun addToCalendar(m: JSONObject) {
        val start = m.optDouble("start")
        if (start.isNaN()) return
        val end = m.optDouble("end").takeUnless { it.isNaN() } ?: start
        val intent = calendarIntent()
            .putExtra(CalendarContract.Events.TITLE, m.optString("title").ifBlank { "Sunset" })
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.toLong())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, max(start, end).toLong())
            .putExtra(CalendarContract.Events.EVENT_LOCATION, m.optString("location"))
            .putExtra(CalendarContract.Events.DESCRIPTION, m.optString("notes"))
        open(intent, R.string.no_calendar)
    }

    /** Android's share sheet: the words and the link, and the picture or calendar file when there is one. */
    private fun share(m: JSONObject) {
        val text = listOf(m.optString("text"), m.optString("url")).filter { it.isNotBlank() }.joinToString("\n")
        val send = Intent(Intent.ACTION_SEND)
        m.optString("title").takeIf { it.isNotBlank() }?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
        if (text.isNotBlank()) send.putExtra(Intent.EXTRA_TEXT, text)
        val file = m.optJSONArray("files")?.optJSONObject(0)
        if (file == null) {
            send.type = "text/plain"
        } else {
            val uri = runCatching { saveShared(file) }.getOrNull() ?: return toast(R.string.share_failed)
            send.type = file.optString("type").ifBlank { "application/octet-stream" }
            send.putExtra(Intent.EXTRA_STREAM, uri)
            send.clipData = ClipData.newRawUri("", uri)
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        open(Intent.createChooser(send, null), R.string.no_app)
    }

    /** The shared file goes to the app's cache (only the latest is kept) and out through the FileProvider. */
    private fun saveShared(file: JSONObject): Uri {
        val dir = File(cacheDir, "shared").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val out = File(dir, Site.safeFileName(file.optString("name")))
        out.writeBytes(Base64.decode(file.getString("data"), Base64.DEFAULT))
        return FileProvider.getUriForFile(this, "$packageName.files", out)
    }

    private fun paintBars(top: Int?, bottom: Int?) {
        val bars = WindowCompat.getInsetsController(window, window.decorView)
        if (top != null) {
            statusBar.setBackgroundColor(top)
            bars.isAppearanceLightStatusBars = Site.isLight(top)
        }
        if (bottom != null) {
            navigationBar.setBackgroundColor(bottom)
            root.setBackgroundColor(bottom)
            bars.isAppearanceLightNavigationBars = Site.isLight(bottom)
        }
    }

    private fun openOutside(uri: Uri) {
        val scheme = uri.scheme?.lowercase() ?: return
        if (scheme !in Site.OUTSIDE_SCHEMES) return
        val intent = Intent(Intent.ACTION_VIEW, uri)
        if (scheme == "http" || scheme == "https") intent.addCategory(Intent.CATEGORY_BROWSABLE)
        open(intent, R.string.no_app)
    }

    private fun open(intent: Intent, failure: Int) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast(failure)
        }
    }

    private fun toast(text: Int) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    // ---------- Lifecycle ----------

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!webGone) web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (!webGone) web.onResume()
    }

    override fun onPause() {
        if (!webGone) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (!webGone) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }
}
