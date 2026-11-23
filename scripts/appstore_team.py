"""Prints the Apple team ID for the App Store Connect API key, read from a registered bundle ID's prefix.

Prefers com.bradcowdrey.goldenhour, else any bundle ID on the account (they share the team's prefix).
Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8. Used by .github/workflows/ios-testflight.yml when the
APPLE_TEAM_ID secret is not set.
"""
from appstore_certs import call

BUNDLE_ID = "com.bradcowdrey.goldenhour"


def main():
    rows = call("GET", f"/bundleIds?filter[identifier]={BUNDLE_ID}&fields[bundleIds]=identifier,seedId")["data"]
    rows = [r for r in rows if r["attributes"].get("identifier") == BUNDLE_ID] or rows
    if not rows:
        rows = call("GET", "/bundleIds?limit=1&fields[bundleIds]=identifier,seedId")["data"]
    seed = rows[0]["attributes"].get("seedId") if rows else None
    if not seed:
        raise SystemExit("::error::Couldn't read the team ID from App Store Connect. Set the APPLE_TEAM_ID secret.")
    print(seed)


if __name__ == "__main__":
    main()
