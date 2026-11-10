import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import App from "./App";
import BrandMark from "./components/BrandMark";

export type Profile = {
  id: string;
  name: string;
  email: string;
  picture?: string;
};
type Identity = {
  profile: Profile | null;
  googleConfigured: boolean;
  demoEnabled: boolean;
  demoMode: "local" | "hosted" | null;
};
type Plan = { name: string; price: string | null; period: string | null };
export type Subscription = {
  testAccess?: boolean;
  testAccessUntil?: string | null;
  plan: Plan;
  active: boolean;
  status: string;
  paidThrough: string | null;
  demo: boolean;
  checkoutEnabled: boolean;
  manageEnabled: boolean;
  payments: Array<{
    id: string;
    date: string;
    status: string;
    paidThrough: string;
  }>;
};
function Logo() {
  return (
    <a className="brand public-brand" href="/" aria-label="Tradzyn home">
      <BrandMark className="brand-icon" />
      <span className="brand-name">
        Trad<span>zyn</span>
      </span>
    </a>
  );
}
const features = [
  [
    "Trading Journal",
    "Write down what you expected, what happened, and what you learned.",
    "Free",
  ],
  [
    "Performance Dashboard",
    "See your saved expected and real P&L side by side.",
    "Free",
  ],
  [
    "Journal-Based Analytics",
    "Track your trend and the balance of positive and negative outcomes.",
    "Free",
  ],
  [
    "AI Screen Recording Companion",
    "Share a screen on your terms and review evidence-based observations after each session.",
    "Premium",
  ],
];
function Landing() {
  const [plan, setPlan] = useState<Plan>();
  useEffect(() => {
    void api<Plan>("/public/plan")
      .then(setPlan)
      .catch(() => {});
  }, []);
  return (
    <div className="public-site">
      <header className="public-header">
        <Logo />
        <nav aria-label="Public navigation">
          <a href="#features">Features</a>
          <a href="#how">How It Works</a>
          <a href="#pricing">Pricing</a>
          <a href="/login">Login</a>
          <a className="public-cta" href="/signup">
            Get Started
          </a>
        </nav>
      </header>
      <section className="landing-hero">
        <div>
          <p className="eyebrow accent">Trading performance, made clearer</p>
          <h1>Trade better. Understand your performance. Build consistency.</h1>
          <p>
            Keep a simple trading journal, compare expected and real P&L, and
            review the decisions behind each session.
          </p>
          <div className="actions">
            <a className="public-cta" href="/signup">
              Get Started
            </a>
            <a href="/login">Login</a>
          </div>
        </div>
        <div
          className="landing-preview panel"
          aria-label="Illustrative dashboard preview"
        >
          <div className="panel-heading">
            <h3>Performance overview</h3>
            <span className="badge">PRODUCT PREVIEW</span>
          </div>
          <div className="preview-metrics">
            {["Total entries", "Expected P&L", "Real P&L", "Difference"].map(
              (label) => (
                <div className="stat" key={label}>
                  <div>{label}</div>
                  <strong>—</strong>
                </div>
              ),
            )}
          </div>
          <div className="preview-grid">
            <p>Your P&L trend appears here after you save journal entries.</p>
          </div>
        </div>
      </section>
      <section id="features" className="landing-section">
        <h2>Your trading review toolkit</h2>
        <div className="landing-cards">
          {features.map(([title, description, access]) => (
            <article className="panel settings" key={title}>
              <span className="badge">{access}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="how" className="landing-section">
        <h2>How it works</h2>
        <ol className="landing-steps">
          <li>Create an account with Google.</li>
          <li>Record your trades in the journal.</li>
          <li>Review expected versus actual performance.</li>
          <li>Subscribe to unlock the AI Screen Recording Companion.</li>
          <li>Review AI observations and session reports.</li>
        </ol>
      </section>
      <section id="pricing" className="landing-section">
        <h2>Pricing</h2>
        <p>
          All core Tradzyn tools are free. Subscribe only to unlock the AI
          Screen Recording Companion.
        </p>
        <div className="landing-cards pricing">
          <article className="panel settings">
            <h3>Free</h3>
            <p>
              Trading Journal, Performance Dashboard and Journal-Based
              Analytics.
            </p>
            <a href="/signup" className="public-cta">
              Create an account
            </a>
          </article>
          <article className="panel settings">
            <h3>Premium</h3>
            <p>
              AI Screen Recording Companion with live observations and session
              reports.
            </p>
            <p>
              {plan?.price && plan.period
                ? `${plan.price} / ${plan.period}`
                : "Price and billing period awaiting owner confirmation."}
            </p>
          </article>
        </div>
      </section>
      <footer className="public-footer">
        <details>
          <summary>About</summary>
          <p>Tradzyn helps traders review their own decisions.</p>
        </details>
        <details>
          <summary>Contact</summary>
          <p>Support contact awaiting owner approval.</p>
        </details>
        <details>
          <summary>Terms</summary>
          <p>Terms of Service awaiting owner approval.</p>
        </details>
        <details>
          <summary>Privacy Policy</summary>
          <p>Privacy policy awaiting owner approval.</p>
        </details>
        <details>
          <summary>Trading Risk Disclaimer</summary>
          <p>
            Trading involves risk. Tradzyn provides review tools and does not
            provide trading signals. Final disclaimer awaiting owner approval.
          </p>
        </details>
      </footer>
    </div>
  );
}
function Login({ identity }: { identity?: Identity }) {
  const params = new URLSearchParams(location.search);
  const reason = params.get("error");
  const [error, setError] = useState(
    reason === "cancelled"
      ? "Google sign-in was cancelled."
      : reason === "unavailable"
        ? "Google sign-in is awaiting configuration."
        : reason
          ? "Google sign-in could not be completed. Please try again."
          : "",
  );
  const [busy, setBusy] = useState(false);
  async function demoLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(
        "/auth/demo",
        "POST",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      location.replace("/app");
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="public-site auth-page">
      <Logo />
      <section className="panel settings auth-panel">
        <h1>
          {location.pathname === "/signup"
            ? "Create your account"
            : "Welcome back"}
        </h1>
        <p>
          {identity?.demoMode === "hosted"
            ? "Enter the demo credentials shared with you."
            : "Continue with your Google account to open your personal Tradzyn workspace."}
        </p>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {identity?.googleConfigured ? (
          <a className="public-cta" href="/api/auth/google">
            Continue with Google
          </a>
        ) : identity?.demoMode !== "hosted" ? (
          <p>
            {identity
              ? "Google sign-in is awaiting owner configuration."
              : "Checking sign-in availability…"}
          </p>
        ) : null}
        {identity?.demoEnabled && (
          <form onSubmit={demoLogin}>
            <h3>
              {identity.demoMode === "hosted"
                ? "Demo sign-in"
                : "Local demo sign-in"}
            </h3>
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={
                  identity.demoMode === "hosted" ? "" : "demo@tradzyn.local"
                }
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button disabled={busy}>
              {identity.demoMode === "hosted"
                ? "Sign in to demo"
                : "Sign in to local demo"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
export function AccountSettings({
  profile,
  subscription,
  logout,
}: {
  profile: Profile;
  subscription?: Subscription;
  logout: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function billing(action: "checkout" | "manage") {
    setBusy(true);
    setError("");
    try {
      const { url } = await api<{ url: string }>(
        "/billing/" + action,
        "POST",
        {},
      );
      location.assign(url);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="two-col account-settings">
      <section className="panel settings">
        <h3>Profile & account</h3>
        {profile.picture && (
          <img
            className="avatar"
            src={profile.picture}
            alt=""
            referrerPolicy="no-referrer"
          />
        )}
        <p>
          {profile.name}
          <br />
          {profile.email}
        </p>
        <button onClick={logout}>Log out</button>
      </section>
      <section className="panel settings" id="subscription">
        <h3>Subscription</h3>
        {subscription ? (
          <>
            <p>
              Current plan: {subscription.active ? "Premium" : "Free"} ·{" "}
              {subscription.testAccess
                ? "TEST ACCESS"
                : subscription.status.replaceAll("_", " ")}
            </p>
            {subscription.demo && (
              <p>Demo Premium access. No payment was made.</p>
            )}
            {subscription.testAccess && (
              <p className="notice">
                Premium test access is enabled for your account until{" "}
                {new Date(subscription.testAccessUntil!).toLocaleString()}.
              </p>
            )}
            {subscription.paidThrough && (
              <p>
                {subscription.demo ? "Demo access until" : "Paid through"}:{" "}
                {new Date(subscription.paidThrough).toLocaleDateString()}
              </p>
            )}
            <p>
              Premium unlocks the AI Screen Recording Companion. Your journal
              and dashboard are free.
            </p>
            <p>
              {subscription.plan.price && subscription.plan.period
                ? `${subscription.plan.price} / ${subscription.plan.period}`
                : "Price and billing period awaiting owner confirmation."}
            </p>
            {!subscription.active && (
              <button
                className="primary"
                disabled={busy || !subscription.checkoutEnabled}
                onClick={() => void billing("checkout")}
              >
                Upgrade to Premium
              </button>
            )}
            {subscription.manageEnabled && (
              <button disabled={busy} onClick={() => void billing("manage")}>
                Manage subscription
              </button>
            )}
            {!subscription.checkoutEnabled &&
              !subscription.demo &&
              !subscription.testAccess && (
                <p>Checkout is awaiting payment provider configuration.</p>
              )}
            <h4>Payment history</h4>
            {subscription.payments.length ? (
              <ul>
                {subscription.payments.map((payment) => (
                  <li key={payment.id}>
                    {new Date(payment.date).toLocaleDateString()} ·{" "}
                    {payment.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No payments recorded.</p>
            )}
          </>
        ) : (
          <p>Loading subscription…</p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
export default function Site() {
  const path = location.pathname;
  const [identity, setIdentity] = useState<Identity>();
  const [subscription, setSubscription] = useState<Subscription>();
  const [error, setError] = useState("");
  const workspace = path === "/app" || path.startsWith("/app/");
  useEffect(() => {
    if (path === "/") return;
    const controller = new AbortController();
    void api<Identity>("/auth/me", "GET", undefined, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (workspace && !result.profile) {
          location.replace("/login");
          return;
        }
        if (!workspace && result.profile) {
          location.replace("/app");
          return;
        }
        setIdentity(result);
        if (result.profile)
          return api<Subscription>("/billing", "GET", undefined, {
            signal: controller.signal,
          }).then(setSubscription);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [path, workspace]);
  const logout = () => {
    void api("/auth/logout", "POST")
      .then(() => location.replace("/"))
      .catch((failure) => setError(failure.message));
  };
  if (path === "/") return <Landing />;
  if (error && !identity)
    return (
      <p className="alert" role="alert">
        {error}
      </p>
    );
  if (!workspace) return <Login identity={identity} />;
  if (!identity?.profile) return <p role="status">Opening your workspace…</p>;
  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <App
        account={identity.profile}
        subscription={subscription}
        logout={logout}
      />
    </>
  );
}
