import jwt, time, json, urllib.request

# Read the actual key from file
with open("AuthKey_4YS72UMN75.p8", "r") as f:
    raw_key = f.read()

key_id = "4YS72UMN75"
issuer = "4YS72UMN75"
team_id = "U7UKMADP3R"

now = int(time.time())
payload = {
    "iss": issuer,
    "iat": now,
    "exp": now + 1200,
    "aud": "appstoreconnect-v1"
}

token = jwt.encode(payload, raw_key, algorithm="ES256", headers={"kid": key_id})

url = "https://api.appstoreconnect.apple.com/v1/apps/6818316186/builds"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        builds = data.get("data", [])
        print(f"Builds found: {len(builds)}")
        for b in builds[:5]:
            attrs = b["attributes"]
            print(f"  Build {attrs['version']}.{attrs['buildNumber']} | Status: {attrs['processingState']} | Expired: {attrs.get('expired', 'N/A')}")
except Exception as e:
    print("Error:", e)
