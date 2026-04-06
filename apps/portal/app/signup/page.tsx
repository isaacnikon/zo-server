import Link from 'next/link';

const CLIENT_DOWNLOAD_HREF = '/downloads/ZO.zip';

function pickSingle(value) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function getSignupMessage(searchParams) {
  const status = pickSingle(searchParams?.status);
  const error = pickSingle(searchParams?.error);

  if (status === 'created') {
    return {
      tone: 'success',
      text: 'Account created. Use the same username and password in the game client.',
    };
  }

  if (error === 'invalid-signup') {
    return {
      tone: 'error',
      text: 'Use a 3-24 character username, a valid email, and a password that is at least 8 characters.',
    };
  }

  if (error === 'username-taken') {
    return {
      tone: 'error',
      text: 'That username already exists.',
    };
  }

  if (error === 'email-taken') {
    return {
      tone: 'error',
      text: 'That email address is already in use.',
    };
  }

  if (error === 'signup-failed') {
    return {
      tone: 'error',
      text: 'We could not create the account. Check the server logs for the database error.',
    };
  }

  return null;
}

export default function SignupPage({ searchParams }) {
  const message = getSignupMessage(searchParams);
  const showCrossPortalLinks = process.env.NODE_ENV !== 'production';

  return (
    <main className="page-grid">
      <section className="hero-card">
        <p className="eyebrow">Join The World</p>
        <h1>Create Your Account</h1>
        <p className="lede">Choose your login details and get ready to step into the world.</p>
      </section>

      <section className="panel signup-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start Playing</p>
            <h2>Create account</h2>
          </div>
          {showCrossPortalLinks ? (
            <p className="hint">
              Admin access lives separately on the <Link href="/admin">admin portal</Link>.
            </p>
          ) : null}
        </div>

        {message ? (
          <p className={`status-banner ${message.tone}`}>{message.text}</p>
        ) : null}

        <form action="/api/signup" className="stack-form" method="post">
          <label className="field">
            <span>Username</span>
            <input
              autoComplete="username"
              maxLength={24}
              minLength={3}
              name="username"
              placeholder="starlight_fox"
              required
              type="text"
            />
          </label>

          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              name="email"
              placeholder="you@example.com"
              required
              type="email"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              required
              type="password"
            />
          </label>

          <button className="primary-button" type="submit">
            Create Account
          </button>
        </form>

        <section className="download-callout" aria-label="Game client download">
          <div>
            <p className="eyebrow">Game Client</p>
            <h3>Download ZO</h3>
            <p className="hint">
              Download the current client and get ready to log in.
            </p>
          </div>

          <a className="download-link" download href={CLIENT_DOWNLOAD_HREF}>
            Download Client ZIP
          </a>
        </section>

        <p className="supporting-text">
          Use these same credentials to log in to the game client.
        </p>
      </section>
    </main>
  );
}
