"""
Buffer Social Media Publishing Engine
Publishes approved clips directly to connected social media channels (TikTok, YouTube Shorts, Facebook).
Formats captions with viral hashtags (#gta6, #ishowspeed, #gaming, etc.) and schedules/drafts posts.
"""

import os
import json
import requests
from typing import List, Dict, Any, Optional
from requests.adapters import HTTPAdapter
from urllib3.util import Retry


class BufferPoster:
    def __init__(
        self,
        api_token: Optional[str] = None,
        organization_id: Optional[str] = None
    ):
        self.api_token = api_token or os.environ.get("BUFFER_API_TOKEN")
        self.organization_id = organization_id or os.environ.get("BUFFER_ORG_ID", "6aff3390741beb0c722bd52e")

        if not self.api_token and os.path.exists(".env"):
            with open(".env", "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("BUFFER_API_TOKEN="):
                        self.api_token = line.strip().split("=", 1)[1]
                    elif line.startswith("BUFFER_ORG_ID="):
                        self.organization_id = line.strip().split("=", 1)[1]
        self.api_url = "https://api.buffer.com"
        
        self.default_hashtags = ["#gta6", "#ishowspeed", "#gaming", "#shorts", "#viral", "#fyp"]

        self.session = requests.Session()
        self.session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1)))
        self.headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
            "User-Agent": "AntigravClip/1.0"
        }

    def get_channels(self) -> List[Dict[str, Any]]:
        """Fetches all connected channels from Buffer."""
        query = """
        query GetChannels($input: ChannelsInput!) {
          channels(input: $input) {
            id
            name
            service
          }
        }
        """
        payload = {
            "query": query,
            "variables": {
                "input": {
                    "organizationId": self.organization_id
                }
            }
        }
        try:
            resp = self.session.post(self.api_url, headers=self.headers, json=payload, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", {}).get("channels", [])
            else:
                print(f"[BufferPoster] Failed to get channels: {resp.status_code} {resp.text}")
                return []
        except Exception as e:
            print(f"[BufferPoster] Error fetching channels: {e}")
            return []

    def format_post_text(self, caption: str, hashtags: Optional[List[str]] = None) -> str:
        """Formats the caption and ensures viral hashtags are included."""
        tags = hashtags or self.default_hashtags
        clean_tags = []
        for tag in tags:
            tag = tag.strip()
            if not tag:
                continue
            if not tag.startswith("#"):
                tag = f"#{tag}"
            clean_tags.append(tag)

        # Avoid duplicate hashtags if already in caption
        caption_lower = caption.lower()
        new_tags = [t for t in clean_tags if t.lower() not in caption_lower]

        if new_tags:
            return f"{caption.strip()}\n\n{' '.join(new_tags)}"
        return caption.strip()

    def post_clip(
        self,
        channel_ids: List[str],
        caption: str,
        hashtags: Optional[List[str]] = None,
        video_url: Optional[str] = None,
        as_draft: bool = False
    ) -> Dict[str, Any]:
        """
        Publishes or drafts an approved clip to the specified Buffer channels.
        Returns mapping of channel_id -> post_id/result.
        """
        full_text = self.format_post_text(caption, hashtags)
        results = {}

        for ch_id in channel_ids:
            assets = []
            if video_url:
                assets.append({"video": {"url": video_url}})

            mutation = """
            mutation CreatePost($input: CreatePostInput!) {
              createPost(input: $input) {
                __typename
                ... on PostActionSuccess {
                  post {
                    id
                    status
                  }
                }
                ... on InvalidInputError {
                  message
                }
                ... on UnexpectedError {
                  message
                }
              }
            }
            """
            post_input: Dict[str, Any] = {
                "channelId": ch_id,
                "text": full_text,
                "mode": "addToQueue",
                "saveToDraft": as_draft,
                "schedulingType": "automatic",
                "needsApproval": False,
                "assets": assets
            }

            try:
                resp = self.session.post(
                    self.api_url,
                    headers=self.headers,
                    json={"query": mutation, "variables": {"input": post_input}},
                    timeout=20
                )
                if resp.status_code == 200:
                    data = resp.json().get("data", {}).get("createPost", {})
                    typename = data.get("__typename")
                    if typename == "PostActionSuccess":
                        post_info = data.get("post", {})
                        results[ch_id] = {
                            "success": True,
                            "post_id": post_info.get("id"),
                            "status": post_info.get("status")
                        }
                        print(f"✅ [BufferPoster] Posted to channel {ch_id}: Post ID {post_info.get('id')} ({post_info.get('status')})")
                    else:
                        err_msg = data.get("message", typename)
                        results[ch_id] = {"success": False, "error": err_msg}
                        print(f"⚠️ [BufferPoster] Channel {ch_id} failed: {err_msg}")
                else:
                    results[ch_id] = {"success": False, "error": f"HTTP {resp.status_code}"}
            except Exception as e:
                results[ch_id] = {"success": False, "error": str(e)}

        return results
