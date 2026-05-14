const BASE = (import.meta.env.VITE_API_URL as string) || "https://api.butterbase.ai/v1/app_hz4h4bcpu63n";
const APP_ID = BASE.split("/").pop()!;
const AUTH_BASE = BASE.replace(/\/v1\/.*$/, `/auth/${APP_ID}`);

const ALLOWED_DOMAINS = ["betauniversity.org", "betafund.ai"];

const KEY = "buttercrm.auth";

type Session = { access_token: string; refresh_token: string; user: { id: string; email: string; display_name?: string }; expires_at: number };

export function getSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s.expires_at && s.expires_at < Date.now()) return null;
    return s;
  } catch { return null; }
}

export function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

export function getToken(): string | null {
  return getSession()?.access_token || null;
}

export function isAllowedDomain(email: string): boolean {
  const d = email.split("@").pop()?.toLowerCase() || "";
  return ALLOWED_DOMAINS.includes(d);
}

async function call(path: string, body: any) {
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || `${res.status}`);
  return data;
}

export async function signup(email: string, password: string, display_name?: string): Promise<Session> {
  if (!isAllowedDomain(email)) throw new Error(`Only @${ALLOWED_DOMAINS.join(" / @")} emails allowed.`);
  await call("/signup", { email, password, display_name });
  // Auto-login after signup
  return login(email, password);
}

export async function login(email: string, password: string): Promise<Session> {
  if (!isAllowedDomain(email)) throw new Error(`Only @${ALLOWED_DOMAINS.join(" / @")} emails allowed.`);
  const data = await call("/login", { email, password });
  const s: Session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
    expires_at: Date.now() + (data.expires_in - 30) * 1000
  };
  setSession(s);
  return s;
}

export async function refresh(): Promise<Session | null> {
  const s = getSession();
  if (!s?.refresh_token) return null;
  try {
    const data = await call("/refresh", { refresh_token: s.refresh_token });
    const ns: Session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user || s.user,
      expires_at: Date.now() + (data.expires_in - 30) * 1000
    };
    setSession(ns);
    return ns;
  } catch {
    setSession(null);
    return null;
  }
}

export function logout() {
  setSession(null);
  location.reload();
}
