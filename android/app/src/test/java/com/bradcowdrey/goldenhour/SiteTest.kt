package com.bradcowdrey.goldenhour

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SiteTest {
    @Test
    fun ownPagesStayInTheApp() {
        assertTrue(Site.isOurs(Site.HOME))
        assertTrue(Site.isOurs("https://bradleycowdrey.github.io/golden-hour"))
        assertTrue(Site.isOurs("https://bradleycowdrey.github.io/golden-hour/#p=abc~def"))
        assertTrue(Site.isOurs("https://BradleyCowdrey.github.io/golden-hour/index.html?x=1"))
        assertTrue(Site.isOurs("https://bradleycowdrey.github.io/golden-hour/cities.tsv"))
        assertTrue(Site.isOurs("blob:https://bradleycowdrey.github.io/1234"))
        assertTrue(Site.isOurs("data:image/png;base64,AAAA"))
        assertTrue(Site.isOurs("about:blank"))
    }

    @Test
    fun everythingElseOpensOutside() {
        assertFalse(Site.isOurs("https://www.google.com/maps/dir/?api=1&destination=39.78,-105.05"))
        assertFalse(Site.isOurs("https://github.com/bradleycowdrey/golden-hour/issues/new?title=Sunset log"))
        assertFalse(Site.isOurs("https://bradcowdrey.com/legal"))
        assertFalse(Site.isOurs("https://bradleycowdrey.github.io/bearings/"))
        assertFalse(Site.isOurs("https://bradleycowdrey.github.io/golden-hours/"))
        assertFalse(Site.isOurs("https://bradleycowdrey.github.io.example.com/golden-hour/"))
        assertFalse(Site.isOurs("http://bradleycowdrey.github.io/golden-hour/"))
        assertFalse(Site.isOurs("sms:?body=Home%20safe"))
        assertFalse(Site.isOurs("tel:+13035550100"))
        assertFalse(Site.isOurs("javascript:alert(1)"))
        assertFalse(Site.isOurs(""))
    }

    @Test
    fun originForTheLocationPrompt() {
        assertTrue(Site.isOurOrigin("https://bradleycowdrey.github.io/"))
        assertTrue(Site.isOurOrigin("https://bradleycowdrey.github.io"))
        assertFalse(Site.isOurOrigin("https://example.com/"))
    }

    @Test
    fun coloursFromThePage() {
        assertEquals(0xFF1A1816.toInt(), Site.colour("#1a1816"))
        assertEquals(0xFF1B2440.toInt(), Site.colour(" #1B2440 "))
        assertNull(Site.colour("rgb(1, 2, 3)"))
        assertNull(Site.colour("#12345"))
        assertNull(Site.colour(null))
        assertFalse(Site.isLight(Site.INK))
        assertFalse(Site.isLight(Site.colour("#1B2440")!!))
        assertTrue(Site.isLight(Site.colour("#FFF1E5")!!))
    }

    @Test
    fun sharedFileNames() {
        assertEquals("golden-hour.ics", Site.safeFileName("golden-hour.ics"))
        assertEquals("Sunset_at_Inspiration_Point.png", Site.safeFileName("Sunset at Inspiration Point.png"))
        assertEquals("_.._etc_passwd", Site.safeFileName("../../etc/passwd"))
        assertEquals("golden-hour", Site.safeFileName(""))
        assertEquals("golden-hour", Site.safeFileName(null))
    }
}
