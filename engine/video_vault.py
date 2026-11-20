import os
import requests
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


def upload_clip_to_vault(video_path: str) -> Optional[str]:
    """Uploads a rendered MP4 clip to the GitHub Release video vault so it has a public CDN URL."""
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPO", "islatechai-lang/antigravclip")
    tag = "v1-clips"

    if not token or not os.path.exists(video_path):
        return None

    filename = os.path.basename(video_path)
    expected_url = f"https://github.com/{repo}/releases/download/{tag}/{filename}"

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "AntigravClip"
    }

    try:
        rel_res = requests.get(f"https://api.github.com/repos/{repo}/releases/tags/{tag}", headers=headers, timeout=15)
        if not rel_res.ok:
            return None
        release_data = rel_res.json()

        # Check if already uploaded
        for asset in release_data.get("assets", []):
            if asset.get("name") == filename:
                return asset.get("browser_download_url", expected_url)

        # Upload binary asset
        upload_url = release_data.get("upload_url", "").split("{")[0]
        if not upload_url:
            return expected_url

        print(f"[VideoVault] Uploading {filename} to public cloud vault...")
        with open(video_path, "rb") as f:
            video_bytes = f.read()

        upload_headers = {
            "Authorization": f"token {token}",
            "Content-Type": "video/mp4",
            "User-Agent": "AntigravClip"
        }
        up_res = requests.post(f"{upload_url}?name={filename}", headers=upload_headers, data=video_bytes, timeout=90)
        if up_res.ok:
            asset_data = up_res.json()
            public_url = asset_data.get("browser_download_url", expected_url)
            print(f"[VideoVault] ☁️ Uploaded successfully! Public URL: {public_url}")
            return public_url
        return expected_url
    except Exception as e:
        print(f"[VideoVault] Warning during upload: {e}")
        return expected_url
