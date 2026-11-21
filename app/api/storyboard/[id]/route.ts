import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rawId = params.id;
    const sbDir = path.join(process.cwd(), "output", "storyboards");

    if (!fs.existsSync(sbDir)) {
      return new NextResponse("Storyboard not found", { status: 404 });
    }

    let target = path.join(sbDir, rawId.endsWith(".jpg") ? rawId : `${rawId}.jpg`);
    if (!fs.existsSync(target)) {
      target = path.join(sbDir, `storyboard_${rawId}.jpg`);
    }

    if (!fs.existsSync(target)) {
      // Look for any storyboard containing the id
      const files = fs.readdirSync(sbDir);
      const match = files.find(f => f.includes(rawId.replace("clip_", "").replace("slice_", "")));
      if (match) {
        target = path.join(sbDir, match);
      }
    }

    if (!fs.existsSync(target)) {
      return new NextResponse("Storyboard not found", { status: 404 });
    }

    const imageBuffer = fs.readFileSync(target);
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    return new NextResponse(err.message, { status: 500 });
  }
}
