import urllib.request, json

token = "UF43IBV4ZctXLD2CNvI5m5m6ykDNsq99ZFP1qeHH"
url = "https://api.expo.dev/graphql"

# Get recent builds from EAS
query = """
query GetBuilds {
    builds {
        forApp(appId: "71e4615e-b60d-484c-9893-84d18a28eb47") {
            id
            status
            platform
            createdAt
            updatedAt
        }
    }
}
"""

q = json.dumps({"query": query}).encode("utf-8")
req = urllib.request.Request(url, data=q, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
        builds = result["data"]["builds"]["forApp"]
        print(f"Found {len(builds)} builds")
        for b in builds[:5]:
            created = b.get("createdAt", "N/A")[:19] if b.get("createdAt") else "N/A"
            print(f"  {b['id'][:8]} | {b['status']:15} | {b['platform']:3} | {created}")
except Exception as e:
    print("Error:", e)
