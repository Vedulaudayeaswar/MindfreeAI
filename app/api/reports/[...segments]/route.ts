import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: { segments: string[] } }) {
  const path = context.params.segments.map(encodeURIComponent).join("/");
  const upstream = new URL(process.env.MINDCARE_BACKEND_URL || "http://127.0.0.1:8000");
  upstream.pathname = `/api/reports/${path}`;
  upstream.search = request.nextUrl.search;
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  try {
    const response = await fetch(upstream, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(), cache: "no-store" });
    const responseHeaders = new Headers({ "content-type": response.headers.get("content-type") || "application/json" });
    for (const name of ["content-disposition", "cache-control"]) { const value = response.headers.get(name); if (value) responseHeaders.set(name, value); }
    return new NextResponse(await response.arrayBuffer(), { status: response.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ detail: "MindCare backend is not running. Start the Python service on port 8000." }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
