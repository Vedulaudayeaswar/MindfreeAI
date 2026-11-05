import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const token = cookies().get("uday_session")?.value;
  if (!token) return NextResponse.json({ user: null });
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { firstName: user.first_name, lastName: user.last_name, email: user.email } });
}
