import Link from 'next/link';

export default function AdminLoginView({ message }) {
  return (
    <main className="page-grid">
      <section className="hero-card">
        <p className="eyebrow">Restricted Access</p>
        <h1>Admin Access</h1>
        <p className="lede">Use the admin token to open the control panel.</p>
      </section>

      <section className="panel admin-auth-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Restricted Access</p>
            <h2>Admin sign-in</h2>
          </div>
          <p className="hint">
            The current version uses `ADMIN_PORTAL_TOKEN`. Redis-backed admin sessions are unnecessary at
            this stage because there is no live traffic and only one portal instance.
          </p>
        </div>

        {message ? (
          <p className={`status-banner ${message.tone}`}>{message.text}</p>
        ) : null}

        <form action="/api/admin/session" className="stack-form" method="post">
          <label className="field">
            <span>Admin token</span>
            <input
              autoComplete="current-password"
              name="token"
              placeholder="Paste ADMIN_PORTAL_TOKEN"
              required
              type="password"
            />
          </label>
          <input name="redirectTo" type="hidden" value="/admin" />
          <button className="primary-button" type="submit">
            Open Admin Portal
          </button>
        </form>

        <p className="supporting-text">
          Admin tooling is separate from player signup on the <Link href="/signup">portal signup</Link> page.
        </p>
      </section>
    </main>
  );
}
