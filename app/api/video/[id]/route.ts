import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { supabase } from "@/lib/supabase";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clipId = params.id;
    const outputDir = path.join(process.cwd(), "output");
    let videoFile = path.join(outputDir, `${clipId}.mp4`);

    if (!fs.existsSync(videoFile)) {
      videoFile = path.join(outputDir, clipId);
    }

    if (!fs.existsSync(videoFile)) {
      // Cloud fallback: check Supabase or GitHub releases
      try {
        const { data: clipData } = await supabase
          .from("clips")
          .select("video_url")
          .eq("id", clipId)
          .maybeSingle();

        const targetUrl = clipData?.video_url || `https://github.com/islatechai-lang/antigravclip/releases/download/v1-clips/${clipId}.mp4`;
        return NextResponse.redirect(targetUrl, 302);
      } catch {
        return NextResponse.redirect(`https://github.com/islatechai-lang/antigravclip/releases/download/v1-clips/${clipId}.mp4`, 302);
      }
    }

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
        },
      });
    }

    const stream = fs.createReadStream(videoFile);
    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        "Content-Length": fileSize.toString(),
        "Content-Type": "video/mp4",
      },
    });
  } catch (err: any) {
    return new NextResponse(err.message, { status: 500 });
  }
}
