import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8001";
  try {
    const res = await fetch(`${backendUrl}/api/logs`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    return NextResponse.json({ logs: [] });
  } catch (err: any) {
    return NextResponse.json({ logs: [] });
  }
}

export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8001";
  try {
    const body = await req.json();
    const res = await fetch(`${backendUrl}/api/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8001";
  try {
    const res = await fetch(`${backendUrl}/api/logs`, { method: "DELETE" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
