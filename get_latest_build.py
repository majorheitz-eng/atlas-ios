import urllib.request, json

token = "UF43IBV4ZctXLD2CNvI5m5m6ykDNsq99ZFP1qeHH"
url = "https://api.expo.dev/v2/projects/71e4615e-b60d-484c-9893-84d18a28eb47/builds?limit=1&platform=ios"

req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
        builds = result.get("data", [])
        if builds:
            b = builds[0]
            print("Latest build ID:", b["id"])
            print("Status:", b["status"])
            print("Platform:", b["platform"])
            print("Created:", b["createdAt"])
            if b.get("artifacts"):
                print("Artifact URL:", b["artifacts"].get("buildUrl", "N/A"))
        else:
            print("No builds found")
except Exception as e:
    print("Error:", e)
