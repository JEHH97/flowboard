"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const API = "/api";

export default function InviteAcceptance() {
  const { token } = useParams<{ token: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Checking your invitation…");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const acceptInvite = useCallback(async () => {
    const response = await fetch(
      `${API}/invites/${encodeURIComponent(token)}/accept`,
      { method: "POST", credentials: "include" },
    );
    if (response.status === 401) {
      setMessage(
        "Sign in with the email address that received this invitation.",
      );
      return false;
    }
    if (!response.ok) {
      setMessage(
        "This invitation is invalid, expired, or meant for another email.",
      );
      return false;
    }
    setAccepted(true);
    setMessage("You’re in. The shared board is ready.");
    return true;
  }, [token]);

  useEffect(() => {
    void acceptInvite();
  }, [acceptInvite]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setMessage(
          "Check your sign-in details, then try the invitation again.",
        );
        return;
      }
      await acceptInvite();
    } catch {
      setMessage("Could not reach the service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark">f</div>
        <p className="eyebrow">A shared space is waiting</p>
        <h1>{accepted ? "Welcome aboard." : "Join the board."}</h1>
        <p className="muted" role="status">
          {message}
        </p>
        {!accepted && (
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="primary wide" disabled={busy}>
              {busy ? "Joining…" : "Sign in and accept invitation"}
            </button>
          </form>
        )}
        <a className="invite-home" href="/">
          Back to Flowboard
        </a>
      </section>
    </main>
  );
}
