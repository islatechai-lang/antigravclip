import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      const res = await fetch(`${backendUrl}/api/logs`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // ignore
    }
  }
  return NextResponse.json({ logs: [] });
}

export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      const body = await req.json();
      await fetch(`${backendUrl}/api/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // ignore
    }
  }
  return NextResponse.json({ status: "logged" });
}

export async function DELETE() {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      await fetch(`${backendUrl}/api/logs`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }
  return NextResponse.json({ status: "cleared" });
}
