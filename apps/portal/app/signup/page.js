import Link from 'next/link';

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
      text: 'The portal could not create the account. Check the portal logs for the database error.',
    };
  }

  return null;
}

export default function SignupPage({ searchParams }) {
  const message = getSignupMessage(searchParams);

  return (
    <main className="page-grid">
      <section className="hero-card">
        <p className="eyebrow">Join The World</p>
        <h1>Create a Zodiac Portal Account</h1>
        <p className="lede">Choose your portal identity and get ready to step into Zodiac Online.</p>
      </section>

      <section className="panel signup-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Portal Signup</p>
            <h2>Create account</h2>
          </div>
          <p className="hint">
            Admin access lives separately on the <Link href="/admin">admin portal</Link>.
          </p>
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
            Create Portal Account
          </button>
        </form>

        <p className="supporting-text">
          After signup, those same credentials can be used for game login.
        </p>
      </section>
    </main>
  );
}
