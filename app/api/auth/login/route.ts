import { NextResponse } from "next/server";
import { authenticateUser, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    const user = authenticateUser(email, password);
    if (!user) return NextResponse.json({ error: "That email and password don’t match." }, { status: 401 });
    const session = createSession(user.id);
    const response = NextResponse.json({ user: { firstName: user.first_name, lastName: user.last_name, email: user.email } });
    response.cookies.set("uday_session", session.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(session.expiresAt) });
    return response;
  } catch {
    return NextResponse.json({ error: "We couldn’t log you in. Please try again." }, { status: 400 });
  }
}
