"""Makes the newest iPhone build installable from TestFlight by the people on the account, and says where it stands.

Through the App Store Connect API it: lists the newest builds and their processing state; answers the export
compliance question if a build hasn't (the app uses no encryption of its own); makes sure there is an internal
TestFlight group ("Team") that gets every build; and adds the account holder and admins to it as testers.
Each step checks what is already there first, so running it again only does what's missing. No names or email
addresses are printed: the logs of a public repository are public.
Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8. Run by .github/workflows/testflight-testers.yml. Needs PyJWT and cryptography.
"""
from urllib.parse import quote

from appstore_certs import call

BUNDLE_ID = "com.bradcowdrey.goldenhour"
GROUP = "Team"


def main():
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        raise SystemExit(f"::error::No app with bundle ID {BUNDLE_ID} in App Store Connect. Create it under My Apps first.")
    app = apps[0]["id"]

    builds = call("GET", f"/builds?filter[app]={app}&sort=-uploadedDate&limit=5")["data"]
    if not builds:
        print("::warning::App Store Connect has no builds for Golden Hour yet. If an upload finished minutes ago, Apple may still be receiving it; if longer, check the account holder's email for a message from Apple about the build.")
    for b in builds:
        a = b["attributes"]
        detail = (call("GET", f"/builds/{b['id']}/buildBetaDetail", soft=True) or {}).get("data", {}).get("attributes", {})
        print(f"::notice::Build {a.get('version')}: {a.get('processingState')}, expired {a.get('expired')}, "
              f"internal testing {detail.get('internalBuildState')}, uploaded {str(a.get('uploadedDate'))[:16]}")
        if a.get("processingState") == "VALID" and a.get("usesNonExemptEncryption") is None:
            call("PATCH", f"/builds/{b['id']}", {"data": {"type": "builds", "id": b["id"], "attributes": {"usesNonExemptEncryption": False}}}, soft=True)

    groups = [g for g in call("GET", f"/betaGroups?filter[app]={app}&limit=50")["data"] if g["attributes"].get("isInternalGroup")]
    if groups:
        group = groups[0]
    else:
        group = call("POST", "/betaGroups", {"data": {"type": "betaGroups",
                     "attributes": {"name": GROUP, "isInternalGroup": True, "hasAccessToAllBuilds": True},
                     "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})["data"]
        print(f"::notice::Made the internal TestFlight group “{GROUP}”. It gets every build.")
    gid = group["id"]
    if not group["attributes"].get("hasAccessToAllBuilds"):
        for b in builds:
            if b["attributes"].get("processingState") == "VALID":
                call("POST", f"/betaGroups/{gid}/relationships/builds", {"data": [{"type": "builds", "id": b["id"]}]}, soft=True)

    already = {t["id"] for t in call("GET", f"/betaGroups/{gid}/betaTesters?limit=200")["data"]}
    users = call("GET", "/users?limit=200&fields[users]=username,firstName,lastName,roles")["data"]
    owners = [u for u in users if {"ACCOUNT_HOLDER", "ADMIN"} & set(u["attributes"].get("roles") or [])]
    added = 0
    for u in owners:
        a = u["attributes"]
        email = a.get("username")
        if not email:
            continue
        found = call("GET", f"/betaTesters?filter[email]={quote(email)}&filter[apps]={app}", soft=True)
        tester = (found or {}).get("data") or []
        if tester and tester[0]["id"] in already:
            continue
        if tester:
            ok = call("POST", f"/betaGroups/{gid}/relationships/betaTesters", {"data": [{"type": "betaTesters", "id": tester[0]["id"]}]}, soft=True)
        else:
            ok = call("POST", "/betaTesters", {"data": {"type": "betaTesters",
                      "attributes": {"email": email, "firstName": a.get("firstName"), "lastName": a.get("lastName")},
                      "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": gid}]}}}}, soft=True)
        added += ok is not None
    print(f"::notice::Internal testers in “{group['attributes'].get('name')}”: {len(already)} already, {added} added now "
          f"(of {len(owners)} account holder and admin users). Each gets an email from TestFlight; the app then shows in the TestFlight app signed in with that Apple ID.")


if __name__ == "__main__":
    main()
