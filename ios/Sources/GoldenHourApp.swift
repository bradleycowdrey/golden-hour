import EventKit
import EventKitUI
import SwiftUI
import UIKit
import WebKit

/// Golden Hour for iPhone, first cut: the web app in a full-screen web view, so TestFlight has the same
/// app the site serves. The site's service worker keeps it working offline once it has been opened
/// (WKAppBoundDomains in Info.plist is what allows a service worker here). Links that leave the site
/// (Google Maps, directions, Messages, GitHub) open in their own apps. Swiping from the left edge goes back a
/// step, and "Add to calendar" opens Calendar's own new-event sheet.
@main
struct GoldenHourApp: App {
    @StateObject private var model = WebModel()

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 0.102, green: 0.094, blue: 0.086).ignoresSafeArea()
                WebScreen(model: model).ignoresSafeArea()
                if model.failed {
                    VStack(spacing: 14) {
                        Text("Can’t reach Golden Hour")
                            .font(.title3.weight(.medium))
                        Text("Check the connection and try again.")
                            .font(.subheadline)
                            .opacity(0.8)
                        Button("Try again") { model.reload() }
                            .buttonStyle(.borderedProminent)
                            .tint(Color(red: 0.957, green: 0.722, blue: 0.376))
                            .foregroundStyle(.black)
                    }
                    .foregroundStyle(.white)
                    .padding(24)
                }
            }
            .preferredColorScheme(.dark)
        }
    }
}

/// Holds the web view and what the screen needs to know about it.
final class WebModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, EKEventEditViewDelegate {
    static let home = URL(string: "https://bradleycowdrey.github.io/golden-hour/")!

    @Published var failed = false
    let web: WKWebView
    private var eventStore: EKEventStore?

    override init() {
        let config = WKWebViewConfiguration()
        config.limitsNavigationsToAppBoundDomains = true
        web = WKWebView(frame: .zero, configuration: config)
        super.init()
        let ink = UIColor(red: 0.102, green: 0.094, blue: 0.086, alpha: 1)
        web.isOpaque = false
        web.backgroundColor = ink
        web.scrollView.backgroundColor = ink
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = true
        web.configuration.userContentController.add(self, name: "goldenHour")
        web.navigationDelegate = self
        web.uiDelegate = self
        web.load(URLRequest(url: Self.home))
    }

    func reload() {
        failed = false
        web.load(URLRequest(url: Self.home))
    }

    private func isOurs(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "about" || scheme == "blob" || scheme == "data" { return true }
        return url.host?.lowercased() == Self.home.host
    }

    private var presenter: UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var top = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if isOurs(url) { decisionHandler(.allow); return }
        // Anything else in the main frame leaves the app: maps, directions, GitHub, mail.
        if navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        failed = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failed = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: Calendar

    /// The page asks for a calendar event; Calendar's own sheet adds it, so no access to the calendar is needed.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "goldenHour", let body = message.body as? [String: Any], body["type"] as? String == "calendar" else { return }
        guard let start = (body["start"] as? NSNumber)?.doubleValue, let end = (body["end"] as? NSNumber)?.doubleValue, let presenter else { return }
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = body["title"] as? String ?? "Sunset"
        event.startDate = Date(timeIntervalSince1970: start / 1000)
        event.endDate = Date(timeIntervalSince1970: max(end, start) / 1000)
        event.location = body["location"] as? String
        event.notes = body["notes"] as? String
        if let minutes = (body["alarm"] as? NSNumber)?.doubleValue { event.addAlarm(EKAlarm(relativeOffset: -minutes * 60)) }
        let editor = EKEventEditViewController()
        editor.eventStore = store
        editor.event = event
        editor.editViewDelegate = self
        eventStore = store
        presenter.present(editor, animated: true)
    }

    func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true)
        eventStore = nil
    }

    // MARK: Windows and dialogs

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let presenter else { completionHandler(); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let presenter else { completionHandler(false); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let presenter else { completionHandler(nil); return }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        presenter.present(alert, animated: true)
    }
}

struct WebScreen: UIViewRepresentable {
    @ObservedObject var model: WebModel

    func makeUIView(context: Context) -> WKWebView { model.web }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
