import requests
import json
import re

# Twitch GQL endpoint allows querying live channels easily without auth
query = """
query {
  game(name: "Grand Theft Auto V") {
    streams(first: 10) {
      edges {
        node {
          broadcaster {
            login
            displayName
          }
          viewersCount
          title
        }
      }
    }
  }
}
"""

headers = {
    "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", # Public Twitch web client-id
    "Content-Type": "application/json"
}

try:
    resp = requests.post("https://gql.twitch.tv/gql", json={"query": query}, headers=headers, timeout=10)
    data = resp.json()
    streams = data.get("data", {}).get("game", {}).get("streams", {}).get("edges", [])
    print("Found Live GTA V Streamers:")
    for s in streams:
        node = s.get("node", {})
        login = node.get("broadcaster", {}).get("login")
        viewers = node.get("viewersCount")
        title = node.get("title")
        print(f" - {login} ({viewers:,} viewers): {title[:50]}")
except Exception as e:
    print("Error querying Twitch GQL:", e)
