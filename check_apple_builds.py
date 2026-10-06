import jwt, time, json, urllib.request

raw_key = """-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgIzVMnwUNMcrDK9F/
7hponRJDHT3XLRxGtvDTnYMK25qgCgYIKoZIzj0DAQEEIgN4Lt0FjVxAKfGz8RjPnJxLdMpZqKxLqGvLxMJxLdM=
-----END PRIVATE KEY-----"""

key_id = "4YS72UMN75"
issuer = "4YS72UMN75"

now = int(time.time())
payload = {
    "iss": issuer,
    "iat": now,
    "exp": now + 1200,
    "aud": "appstoreconnect-v1"
}

try:
    token = jwt.encode(payload, raw_key, algorithm="ES256", headers={"kid": key_id})
    
    url = "https://api.appstoreconnect.apple.com/v1/apps/6818316186/builds"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        builds = data.get("data", [])
        print(f"Builds found: {len(builds)}")
        for b in builds[:5]:
            attrs = b["attributes"]
            print(f"  Build {attrs['version']}.{attrs['buildNumber']} | Status: {attrs['processingState']} | Uploaded: {attrs.get('uploadedDate', 'N/A')}")
except Exception as e:
    print("Error:", e)
