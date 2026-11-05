"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";

type Mode = "login" | "register" | "forgot";

const passwordHint = "At least 8 characters, with 1 uppercase, 1 lowercase, 1 number, and 1 special character.";

export default function AuthExperience({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function changeMode(next: Mode) {
    setNotice("");
    setError("");
    setMode(next);
    window.history.replaceState(null, "", next === "register" ? "/register" : next === "forgot" ? "/forgot-password" : "/login");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (mode !== "login" && password !== form.get("confirmPassword")) {
      setBusy(false);
      setError("Your passwords don’t match.");
      return;
    }
    const endpoint = mode === "register" ? "/api/auth/register" : mode === "forgot" ? "/api/auth/forgot-password" : "/api/auth/login";
    const body = mode === "register"
      ? { firstName: form.get("firstName"), lastName: form.get("lastName"), email, password }
      : mode === "forgot" ? { email, password } : { email, password };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Something went wrong.");
      if (mode === "forgot") {
        setNotice(result.message);
        changeMode("login");
        setNotice(result.message);
      } else {
        setNotice(mode === "register" ? "Your account is ready. Welcome!" : `Welcome back${result.user?.firstName ? `, ${result.user.firstName}` : ""}!`);
        window.location.assign("/chat");
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  return (
    <main className={`auth-page ${isRegister ? "auth-register" : ""} ${isForgot ? "auth-forgot-mode" : ""}`}>
      <a href="/" className="auth-back"><ArrowLeft size={16} /> Back to MindCare</a>
      <div className={`auth-stage ${isRegister ? "register" : ""}`}>
        <aside className={`auth-visual ${isRegister ? "register-visual" : "login-visual"}`}>
          <img src={isRegister ? "/register.png?v=3177ECA" : "/login.png?v=7808B11"} alt="" />
          <div className="auth-visual-shade" />
          <div className="auth-image-mark">SASTRA <span>MINDCARE AI</span></div>
          <div className="auth-visual-copy">
            <span className="auth-kicker">{isRegister ? "A FRESH START" : "DIGITAL EXPERIENCES / BUILT FOR TOMORROW"}</span>
            <h2>{isRegister ? <>Make room<br />for better.</> : <>Good to see<br />you again.</>}</h2>
            <p>{isRegister ? "Create your account and take a small step toward a steadier study-life balance." : "Sign in to continue your MindCare well-being journey."}</p>
          </div>
        </aside>

        <section className="auth-form-panel">
          <div className="auth-form-wrap">
            <a href="/" className="auth-wordmark">SASTRA <span>MINDCARE AI</span></a>
            <p className="auth-kicker auth-form-kicker">YOUR NEXT CHAPTER STARTS HERE</p>
            <h1>{isForgot ? "Reset password" : isRegister ? "Create your account" : "Welcome back"}</h1>
            <p className="auth-switch-copy">
              {isForgot ? "Remembered your password?" : isRegister ? "Already have an account?" : "New to SASTRA MindCare AI?"}{" "}
              <button type="button" onClick={() => changeMode(isForgot || isRegister ? "login" : "register")}>{isForgot || isRegister ? "Log in" : "Create an account"}</button>
            </p>

            <form className="auth-form" onSubmit={submit}>
              {isRegister && <div className="auth-name-row"><label>First name<input name="firstName" autoComplete="given-name" placeholder="First name" required /></label><label>Last name<input name="lastName" autoComplete="family-name" placeholder="Last name" required /></label></div>}
              <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
              <label>{isForgot ? "New password" : "Password"}<span className="auth-password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} placeholder={isForgot ? "Create a new password" : "Enter your password"} minLength={8} required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
              {(isRegister || isForgot) && <p className="auth-password-hint">{passwordHint}</p>}
              {(isRegister || isForgot) && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" placeholder="Enter your password again" minLength={8} required /></label>}
              {isForgot && <p className="auth-demo-note">Local demo reset: enter the email on your account. Email verification has not been set up.</p>}
              {!isRegister && !isForgot && <button type="button" className="auth-forgot" onClick={() => changeMode("forgot")}>Forgot password?</button>}
              {error && <p className="auth-message error" role="alert">{error}</p>}
              {notice && <p className="auth-message success" role="status">{notice}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : isForgot ? "Update password" : isRegister ? "Create account" : "Log in"}<ArrowRight size={18} /></button>
            </form>
            <p className="auth-secure-note"><span /> Passwords are securely hashed before storage.</p>
            <a href="/" className="auth-mobile-back">Back to MindCare <ArrowRight size={14} /></a>
          </div>
        </section>
      </div>
    </main>
  );
}
