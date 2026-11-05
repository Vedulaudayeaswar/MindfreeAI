import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = cookies();
  const token = cookieStore.get("uday_session")?.value;
  if (token) deleteSession(token);
  const response = NextResponse.json({ success: true });
  response.cookies.set("uday_session", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(0) });
  return response;
}
