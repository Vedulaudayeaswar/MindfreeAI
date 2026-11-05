import { NextResponse } from "next/server";
import { createSession, createUser, validatePassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { firstName, lastName, email, password } = await request.json();
    if (![firstName, lastName, email, password].every((value) => typeof value === "string" && value.trim())) {
      return NextResponse.json({ error: "Please complete every field." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (!validatePassword(password)) return NextResponse.json({ error: "Use at least 8 characters with an uppercase letter, lowercase letter, number, and special character." }, { status: 400 });
    const user = createUser(firstName, lastName, email, password);
    if (!user) return NextResponse.json({ error: "This email is already registered. Please log in." }, { status: 409 });
    const session = createSession(user.id);
    const response = NextResponse.json({ user: { firstName: user.first_name, lastName: user.last_name, email: user.email } }, { status: 201 });
    response.cookies.set("uday_session", session.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(session.expiresAt) });
    return response;
  } catch {
    return NextResponse.json({ error: "We couldn’t create your account. Please try again." }, { status: 400 });
  }
}
