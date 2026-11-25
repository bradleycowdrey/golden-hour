package com.bradcowdrey.goldenhour

/** The published web app the Android app shows (the same address as the iPhone app), and the small rules
 *  about it that don't need Android: which links stay in the app, and the colours the page sends. */
object Site {
    const val HOST = "bradleycowdrey.github.io"
    const val PATH = "/golden-hour/"
    const val HOME = "https://$HOST$PATH"
    const val ORIGIN = "https://$HOST"

    /** The page's own background (theme-color in web/index.html), until it says otherwise. */
    const val INK = 0xFF1A1816.toInt()

    /** Links that stay in the app: Golden Hour's own pages, and the page's own blob:, data: and about: URLs.
     *  Everything else (Google Maps, directions, GitHub, the terms, messages, calls) opens in its own app. */
    fun isOurs(url: String): Boolean {
        val scheme = url.substringBefore(':', "").lowercase()
        if (scheme == "about" || scheme == "blob" || scheme == "data") return true
        if (scheme != "https" || !url.regionMatches(0, "https://", 0, 8, ignoreCase = true)) return false
        val rest = url.substring(8)
        val end = rest.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) rest.length else it }
        val host = rest.substring(0, end)
        val path = rest.substring(end).substringBefore('?').substringBefore('#')
        return host.equals(HOST, ignoreCase = true) && "$path/".startsWith(PATH)
    }

    /** The page's origin as WebView reports it to the location prompt ("https://bradleycowdrey.github.io/"). */
    fun isOurOrigin(origin: String): Boolean = origin.trimEnd('/').equals(ORIGIN, ignoreCase = true)

    /** Schemes other than https the page links to and that may open another app: Text a friend, Call. */
    val OUTSIDE_SCHEMES = setOf("http", "https", "sms", "smsto", "tel", "mailto", "geo")

    /** "#1a2b3c" as an opaque colour, or null. */
    fun colour(hex: String?): Int? {
        val h = hex?.trim() ?: return null
        if (h.length != 7 || h[0] != '#') return null
        val rgb = h.substring(1).toLongOrNull(16) ?: return null
        return (0xFF000000L or rgb).toInt()
    }

    /** Whether a colour is light enough to need dark status-bar icons. */
    fun isLight(colour: Int): Boolean {
        val r = (colour shr 16) and 0xFF
        val g = (colour shr 8) and 0xFF
        val b = colour and 0xFF
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150
    }

    /** A file name the page gave a shared file, made safe to write to the app's cache. */
    fun safeFileName(name: String?): String {
        val clean = (name ?: "").replace(Regex("[^A-Za-z0-9._-]"), "_").trimStart('.').take(64)
        return clean.ifBlank { "golden-hour" }
    }
}
