import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getOrUploadVideoToVault } from "@/lib/videoVault";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clipId, caption, hashtags, channelIds } = body;

    if (!clipId) {
      return NextResponse.json({ error: "Missing clipId" }, { status: 400 });
    }

    let token = process.env.BUFFER_API_TOKEN;
    if (!token) {
      // Check local .env file
      const envPath = path.join(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          if (line.startsWith("BUFFER_API_TOKEN=")) {
            token = line.split("=")[1].trim();
            break;
          }
        }
      }
    }

    if (!token) {
      return NextResponse.json({ error: "BUFFER_API_TOKEN is not configured" }, { status: 500 });
    }

    // 1. Get or upload video to public vault so Buffer can download it
    const videoUrl = await getOrUploadVideoToVault(clipId);
    console.log(`[API /approve] Using public video URL for ${clipId}: ${videoUrl}`);

    const selectedChannels = channelIds && channelIds.length > 0
      ? channelIds
      : ["6aff36d6ece6dfde5f223b82", "6aff37d0ece6dfde5f224463", "6aff398dece6dfde5f226a6a"];

    // Format post text
    const tagList = Array.isArray(hashtags) ? hashtags : ["#gta6", "#ishowspeed", "#gaming", "#shorts", "#viral", "#fyp"];
    const cleanTags = tagList.map((t: string) => t.trim().startsWith("#") ? t.trim() : `#${t.trim()}`);
    let fullText = caption ? caption.trim() : "Speed crazy GTA 6 moment! 💀";
    const missingTags = cleanTags.filter((t: string) => !fullText.toLowerCase().includes(t.toLowerCase()));
    if (missingTags.length > 0) {
      fullText = `${fullText}\n\n${missingTags.join(" ")}`;
    }

    // Determine clean title (under 95 chars)
    const cleanTitle = (caption.split("\n")[0] || "Speed GTA 6 Moment").slice(0, 85);

    const postResults: Record<string, any> = {};
    let atLeastOneSuccess = false;

    for (const channelId of selectedChannels) {
      // Build platform metadata
      const metaObj: Record<string, any> = {};
      if (channelId === "6aff36d6ece6dfde5f223b82") {
        // TikTok
        metaObj.tiktok = {
          title: cleanTitle,
          isAiGenerated: false
        };
      } else if (channelId === "6aff37d0ece6dfde5f224463") {
        // YouTube Shorts
        metaObj.youtube = {
          title: `${cleanTitle} #shorts`,
          categoryId: "20", // Gaming
          privacy: "public",
          madeForKids: false
        };
      } else if (channelId === "6aff398dece6dfde5f226a6a") {
        // Facebook
        metaObj.facebook = {
          type: "reel"
        };
      }

      const mutation = `
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
      `;

      const inputPayload: any = {
        channelId,
        text: fullText,
        mode: "addToQueue",
        saveToDraft: false,
        schedulingType: "automatic",
        needsApproval: false,
        assets: videoUrl ? [{ video: { url: videoUrl } }] : [],
        metadata: metaObj
      };

      try {
        const resp = await fetch("https://api.buffer.com", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          },
          body: JSON.stringify({
            query: mutation,
            variables: { input: inputPayload }
          })
        });

        if (resp.ok) {
          const resData = await resp.json();
          const createPostData = resData?.data?.createPost;
          if (createPostData?.__typename === "PostActionSuccess") {
            atLeastOneSuccess = true;
            postResults[channelId] = {
              success: true,
              postId: createPostData.post?.id,
              status: createPostData.post?.status
            };
          } else {
            postResults[channelId] = {
              success: false,
              error: createPostData?.message || createPostData?.__typename
            };
          }
        } else {
          postResults[channelId] = { success: false, error: `HTTP ${resp.status}` };
        }
      } catch (err: any) {
        postResults[channelId] = { success: false, error: err.message };
      }
    }

    // Update local data/clips.json if writable
    const dataPath = path.join(process.cwd(), "data", "clips.json");
    if (fs.existsSync(dataPath)) {
      try {
        const raw = fs.readFileSync(dataPath, "utf-8");
        const clips = JSON.parse(raw);
        const target = clips.find((c: any) => c.id === clipId);
        if (target) {
          if (atLeastOneSuccess) {
            target.status = "posted";
          }
          target.caption = caption;
          target.hashtags = cleanTags;
          target.video_url = videoUrl;
          target.posted_channels = selectedChannels;
          target.buffer_post_ids = postResults;
          target.approved_at = new Date().toISOString();
          fs.writeFileSync(dataPath, JSON.stringify(clips, null, 2), "utf-8");
        }
      } catch {
        // Read-only filesystem on Vercel serverless
      }
    }

    // Update in Supabase Database if table exists
    try {
      await supabase
        .from("clips")
        .update({
          status: atLeastOneSuccess ? "posted" : "pending",
          caption,
          hashtags: cleanTags,
          video_url: videoUrl,
          posted_channels: selectedChannels,
          buffer_post_ids: postResults,
          approved_at: new Date().toISOString()
        })
        .eq("id", clipId);
    } catch (sbErr) {
      console.warn("Supabase update skipped:", sbErr);
    }

    if (!atLeastOneSuccess) {
      const firstError = Object.values(postResults).find((r: any) => !r.success)?.error || "Buffer rejected the post";
      return NextResponse.json({
        success: false,
        error: firstError,
        postResults
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      clipId,
      videoUrl,
      postResults
    });
  } catch (error: any) {
    console.error("Failed to approve clip:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
