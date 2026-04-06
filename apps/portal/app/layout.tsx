import Link from 'next/link';

import './globals.css';

export const metadata = {
  title: 'ZO',
  description: 'Join the world and manage live operations for the ZO server.',
};

export default function RootLayout({ children }) {
  const showCrossPortalLinks = process.env.NODE_ENV !== 'production';
  const brandHref = showCrossPortalLinks ? '/signup' : '/';

  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="topbar">
            <div className="brand-block">
              <p className="eyebrow">Join The World</p>
              <Link className="brand" href={brandHref}>
                ZO
              </Link>
            </div>
            {showCrossPortalLinks ? (
              <nav className="topnav">
                <Link href="/signup">Signup</Link>
                <Link href="/admin">Admin</Link>
              </nav>
            ) : null}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
