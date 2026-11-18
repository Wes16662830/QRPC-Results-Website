import { useState } from "react";
import { useNavigate } from "react-router";
import { post } from "../api";
import { ErrorBox } from "../ui";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="mb-6 text-center">
        <img src="/favicon.svg" alt="" className="mx-auto mb-3 h-14 w-14" />
        <h1 className="text-xl font-bold">Queenstown Racing Pigeon Club</h1>
        <p className="text-sm text-muted">Results and 5-bird championship</p>
      </div>
      <form
        className="card space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post("/api/login", { password });
            await onLoggedIn();
            navigate("/", { replace: true });
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm font-medium" htmlFor="pw">
          Club password
        </label>
        <input id="pw" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <ErrorBox error={error} />}
        <button className="btn btn-primary w-full justify-center" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-muted">Ask the club secretary for the password.</p>
      </form>
      <p className="mt-4 text-center text-xs text-muted">
        Club admin?{" "}
        <a href="/admin" className="underline underline-offset-2">
          Sign in here
        </a>
      </p>
    </div>
  );
}
