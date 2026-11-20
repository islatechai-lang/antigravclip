import { NextResponse } from "next/server";

export async function GET() {
  const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8001";
  try {
    const res = await fetch(`${backendUrl}/api/status`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    return NextResponse.json({ is_running: false, channel: "offline", error: "Backend unreachable" });
  } catch (err: any) {
    return NextResponse.json({ is_running: false, channel: "offline", error: err.message });
  }
}

export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8001";
  try {
    const body = await req.json();
    const action = body.action || "start"; // "start" or "stop"

    if (action === "stop") {
      const res = await fetch(`${backendUrl}/api/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      return NextResponse.json(data);
    } else {
      const res = await fetch(`${backendUrl}/api/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: body.channel || "ishowspeed",
          platform: body.platform || "youtube"
        })
      });
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
