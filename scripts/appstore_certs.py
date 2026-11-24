"""Revokes the throwaway development certificates that automated iPhone builds leave behind.

Each build signs on a fresh machine: Xcode creates an "Apple Development: Created via API" certificate whose
private key is lost when the machine goes away, and Apple caps how many an account may hold. This revokes only
those (DEVELOPMENT / IOS_DEVELOPMENT, named "Created via API"); the owner's own certificates (Developer ID,
Apple Distribution, and any development certificate with a person's name) are never touched.
Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8. Run by .github/workflows/ios-testflight.yml before each archive.
Needs PyJWT and cryptography. The same script, and the same rule, as in the Two Degrees repository.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

import jwt

API = "https://api.appstoreconnect.apple.com/v1"
THROWAWAY_TYPES = {"DEVELOPMENT", "IOS_DEVELOPMENT"}


def token():
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      os.environ["ASC_KEY_P8"], algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def call(method, path, body=None, soft=False):
    """Calls the API. A failure stops the run, or with soft=True is reported as a warning and returns None.
    Email addresses in Apple's replies are never printed: these logs are public."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        detail = re.sub(r"[\w.+-]+@[\w.-]+", "(email)", " ".join(e.read().decode().split()))[:1200]
        print(f"::{'warning' if soft else 'error'}::{method} {path.split('?')[0]} → {e.code}: {detail}")
        if soft:
            return None
        raise SystemExit(1)


def main():
    certs = call("GET", "/certificates?limit=200&fields[certificates]=name,certificateType,displayName")["data"]
    revoked = 0
    for c in certs:
        a = c["attributes"]
        name = a.get("name") or a.get("displayName") or ""
        if a.get("certificateType") in THROWAWAY_TYPES and "Created via API" in name:
            call("DELETE", f"/certificates/{c['id']}")
            revoked += 1
    print(f"::notice::Revoked {revoked} throwaway build certificate(s); kept {len(certs) - revoked} (yours are never touched).")


if __name__ == "__main__":
    main()
