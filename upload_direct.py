import jwt, time, json, urllib.request, os

raw_key = """-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgIzVMnwUNMcrDK9F/
7hponRJDHT3XLRxGtvDTnYMK25qgCgYIKoZIzj0DAQehRANCAASFPZe8m2LzEkZh
zee0l8Jgec8T5tXbJugE/Rladfwb6zDuREO+Dh+FOdb5sepqYqh4lOO4cl8JkGnx
6RO64P1N
-----END PRIVATE KEY-----"""

key_id = "4YS72UMN75"
issuer_id = "98cc8215-df4b-4071-993d-2f83eb0e502d"
apple_jwt = jwt.encode({"iss": issuer_id, "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"}, raw_key, algorithm="ES256", headers={"kid": key_id})

ipa_path = r"C:\Users\Major\Documents\Atlas-check.ipa"
print("IPA file exists:", os.path.exists(ipa_path))
print("IPA file size:", os.path.getsize(ipa_path), "bytes")

# Get upload instructions from Apple
headers = {"Authorization": f"Bearer {apple_jwt}"}
req = urllib.request.Request("https://api.appstoreconnect.apple.com/v1/platforms/IOS/appStoreConnectUploadUrls", headers=headers, method="POST")
req.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
        print("Upload URL response:", result)
except Exception as e:
    print("Error getting upload URL:", e)
