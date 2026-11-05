import { NextResponse } from "next/server";
import { updatePassword, validatePassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Password reset is unavailable until email verification is configured." }, { status: 503 });
  try {
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your email and a new password." }, { status: 400 });
    if (!validatePassword(password)) return NextResponse.json({ error: "Use at least 8 characters with an uppercase letter, lowercase letter, number, and special character." }, { status: 400 });
    const changed = updatePassword(email, password);
    if (!changed) return NextResponse.json({ error: "No account was found with that email." }, { status: 404 });
    return NextResponse.json({ message: "Your password has been updated. You can now log in." });
  } catch {
    return NextResponse.json({ error: "We couldn’t update your password. Please try again." }, { status: 400 });
  }
}
