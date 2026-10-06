import urllib.request, json

token = "UF43IBV4ZctXLD2CNvI5m5m6ykDNsq99ZFP1qeHH"
url = "https://api.expo.dev/graphql"

# Query the submission status
query = """
query GetSubmission {
    submissions {
        byId(submissionId: "464d16f6-21be-4225-ae4a-8a06e54a16f2") {
            id
            status
            error
            build {
                id
                status
                artifactUrl
            }
        }
    }
}
"""

q = json.dumps({"query": query}).encode("utf-8")
req = urllib.request.Request(url, data=q, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
        sub = result["data"]["submissions"]["byId"]
        print("Submission ID:", sub["id"])
        print("Status:", sub["status"])
        print("Error:", sub.get("error", "None"))
        if sub.get("build"):
            print("Build ID:", sub["build"]["id"])
            print("Build Status:", sub["build"]["status"])
            print("Artifact URL:", sub["build"].get("artifactUrl", "N/A"))
        else:
            print("No build info available")
except Exception as e:
    print("Error:", e)
