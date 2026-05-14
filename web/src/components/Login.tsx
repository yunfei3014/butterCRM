import React, { useState } from "react";
import { signup, login, isAllowedDomain } from "../lib/auth";

export function Login({ onSession }: any) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isAllowedDomain(email)) {
      setError("Access limited to @betauniversity.org and @betafund.ai emails.");
      return;
    }
    setBusy(true);
    try {
      const s = mode === "signup" ? await signup(email, password, name) : await login(email, password);
      onSession(s);
    } catch (e: any) {
      setError(e.message || "Auth failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">🧈</div>
          <h1>butterCRM</h1>
          <div className="muted">Beta Fund · CRM on Butterbase</div>
        </div>
        <div className="login-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
        </div>
        <form onSubmit={submit} className="login-form">
          {mode === "signup" && (
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@betauniversity.org"
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "≥8 chars, mix of upper/lower/number/special" : "Your password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="btn btn-accent login-submit" disabled={busy}>
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <div className="login-note">
          Access limited to <strong>@betauniversity.org</strong> and <strong>@betafund.ai</strong> emails.
        </div>
      </div>
    </div>
  );
}
