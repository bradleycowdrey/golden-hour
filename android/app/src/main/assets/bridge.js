// Golden Hour for Android: what the page needs from the phone. MainActivity runs this in the Golden Hour page
// (only on bradleycowdrey.github.io), before the page's own scripts where the phone's WebView allows it, and
// again once the page has loaded. It talks to the app through window.GoldenHourAndroid.postMessage.
//  - Add to calendar: the page already sends the iPhone app a message (window.webkit.messageHandlers
//    .goldenHour) with the plan's title, times, place and notes. Here the same message opens the calendar
//    app's own new-event screen. When the phone has no calendar app, the page shares its .ics file instead.
//  - Share: navigator.share and canShare, answered by Android's share sheet, with the picture or file.
//  - The status and navigation bars take the colours at the top and bottom of the page.
(function () {
  'use strict';
  var bridge = window.GoldenHourAndroid;
  if (!bridge || window.__goldenHourAndroid) return;
  window.__goldenHourAndroid = true;
  var send = function (message) { bridge.postMessage(JSON.stringify(message)); };

  if (__HAS_CALENDAR__ && !window.webkit) {
    window.webkit = { messageHandlers: { goldenHour: { postMessage: function (m) { send(m); } } } };
  }

  var read = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  };
  navigator.canShare = function (data) {
    return !!data && Array.prototype.every.call(data.files || [], function (f) { return f instanceof Blob; });
  };
  navigator.share = async function (data) {
    var d = data || {}, files = [];
    for (var i = 0; i < (d.files || []).length; i++) {
      var f = d.files[i];
      files.push({ name: f.name || 'golden-hour', type: f.type || 'application/octet-stream', data: await read(f) });
    }
    send({ type: 'share', title: d.title || '', text: d.text || '', url: d.url || '', files: files });
  };

  // The sky's colour at the top (--sky-top, set for each evening) and, at the bottom, the tab bar over the
  // sky's horizon colour; both darker while a sheet's backdrop covers the page.
  var hex = function (v) { v = (v || '').trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : null; };
  var mix = function (a, b, k) {
    return '#' + [1, 3, 5].map(function (i) {
      var x = parseInt(a.substr(i, 2), 16), y = parseInt(b.substr(i, 2), 16);
      return ('0' + Math.round(x + (y - x) * k).toString(16)).slice(-2);
    }).join('');
  };
  var last = '';
  var bars = function () {
    var css = getComputedStyle(document.documentElement);
    var top = hex(css.getPropertyValue('--sky-top')) || '#1a1816';
    var bottom = hex(css.getPropertyValue('--sky-bottom')) || '#1a1816';
    var tabs = document.getElementById('bar'), box = tabs && tabs.getBoundingClientRect();
    if (box && box.width > window.innerWidth * 0.8 && Math.abs(box.bottom - window.innerHeight) < 2) bottom = mix(bottom, '#141210', 0.9);
    var back = document.getElementById('sheetback');
    if (back && !back.hidden) { top = mix(top, '#000000', 0.55); bottom = mix(bottom, '#000000', 0.55); }
    if (top + bottom !== last) { last = top + bottom; send({ type: 'bars', top: top, bottom: bottom }); }
  };
  var watch = function () {
    bars();
    var seen = new MutationObserver(bars);
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    var back = document.getElementById('sheetback');
    if (back) seen.observe(back, { attributes: true, attributeFilter: ['hidden'] });
    ['resize', 'load', 'popstate', 'hashchange'].forEach(function (e) { window.addEventListener(e, bars); });
    setTimeout(bars, 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
