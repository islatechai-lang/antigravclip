import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rawId = params.id;
    const clipId = rawId.endsWith(".mp4") ? rawId.slice(0, -4) : rawId;
    const outputDir = path.join(process.cwd(), "output");
    let videoFile = path.join(outputDir, `${clipId}.mp4`);

    if (!fs.existsSync(videoFile)) {
      videoFile = path.join(outputDir, rawId);
    }

    // 1. Direct Local File Streaming (Instant 0ms NVMe playback)
    if (fs.existsSync(videoFile)) {
      const stat = fs.statSync(videoFile);
      const fileSize = stat.size;
      const range = req.headers.get("range");

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const stream = fs.createReadStream(videoFile, { start, end });

        return new NextResponse(stream as any, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize.toString(),
            "Content-Type": "video/mp4",
            "Content-Disposition": "inline",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      const stream = fs.createReadStream(videoFile);
      return new NextResponse(stream as any, {
        status: 200,
        headers: {
          "Content-Length": fileSize.toString(),
          "Content-Type": "video/mp4",
          "Content-Disposition": "inline",
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // 2. Cloud Streaming Proxy (Streams from GitHub/Supabase with video/mp4 + inline)
    let targetUrl = `https://github.com/islatechai-lang/antigravclip/releases/download/v1-clips/${clipId}.mp4`;
    try {
      const { data: clipData } = await supabase
        .from("clips")
        .select("video_url")
        .eq("id", clipId)
        .maybeSingle();

      if (clipData?.video_url && clipData.video_url.startsWith("http")) {
        targetUrl = clipData.video_url;
      }
    } catch {
      // Fallback to default targetUrl
    }

    const range = req.headers.get("range");
    const upstreamHeaders: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AntigravClip",
    };
    if (range) {
      upstreamHeaders["Range"] = range;
    }

    try {
      const upstreamRes = await fetch(targetUrl, {
        headers: upstreamHeaders,
        redirect: "follow",
      });

      if (!upstreamRes.ok && upstreamRes.status !== 206) {
        return NextResponse.redirect(targetUrl, 302);
      }

      const resHeaders = new Headers();
      resHeaders.set("Content-Type", "video/mp4");
      resHeaders.set("Content-Disposition", "inline");
      resHeaders.set("Accept-Ranges", "bytes");
      resHeaders.set("Cache-Control", "public, max-age=31536000, immutable");

      const contentRange = upstreamRes.headers.get("content-range");
      if (contentRange) {
        resHeaders.set("Content-Range", contentRange);
      }

      const contentLength = upstreamRes.headers.get("content-length");
      if (contentLength) {
        resHeaders.set("Content-Length", contentLength);
      }

      return new NextResponse(upstreamRes.body as any, {
        status: upstreamRes.status,
        headers: resHeaders,
      });
    } catch {
      return NextResponse.redirect(targetUrl, 302);
    }
  } catch (err: any) {
    return new NextResponse(err.message, { status: 500 });
  }
}
