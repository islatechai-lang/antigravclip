import fs from "fs";
import path from "path";

export async function getOrUploadVideoToVault(clipId: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN || "";
  const repo = process.env.GITHUB_REPO || "islatechai-lang/antigravclip";
  const tag = "v1-clips";

  // Check local video file
  const outputDir = path.join(process.cwd(), "output");
  let videoPath = path.join(outputDir, `${clipId}.mp4`);
  if (!fs.existsSync(videoPath)) {
    videoPath = path.join(outputDir, clipId);
  }

  const filename = path.basename(videoPath);
  const expectedDirectUrl = `https://github.com/${repo}/releases/download/${tag}/${filename}`;

  // Check if asset already exists in release
  const headers = {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "AntigravClip"
  };

  try {
    const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
      headers,
      cache: "no-store"
    });

    let releaseData: any;
    if (relRes.ok) {
      releaseData = await relRes.json();
      const existingAsset = releaseData.assets?.find((a: any) => a.name === filename);
      if (existingAsset?.browser_download_url) {
        return existingAsset.browser_download_url;
      }
    } else {
      // Create release
      const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: "main",
          name: "AntigravClip Video Vault",
          body: "Automated video asset vault for social media publishing.",
          draft: false,
          prerelease: false
        })
      });
      if (createRes.ok) {
        releaseData = await createRes.json();
      } else {
        return expectedDirectUrl;
      }
    }

    // Upload video file if it exists locally
    if (fs.existsSync(videoPath) && releaseData?.upload_url) {
      const uploadUrl = releaseData.upload_url.split("{")[0];
      const videoBuffer = fs.readFileSync(videoPath);

      const upRes = await fetch(`${uploadUrl}?name=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: {
          "Authorization": `token ${token}`,
          "Content-Type": "video/mp4",
          "User-Agent": "AntigravClip"
        },
        body: videoBuffer
      });

      if (upRes.ok) {
        const assetData = await upRes.json();
        return assetData.browser_download_url || expectedDirectUrl;
      }
    }

    return expectedDirectUrl;
  } catch (err) {
    console.error("Error uploading to video vault:", err);
    return expectedDirectUrl;
  }
}
