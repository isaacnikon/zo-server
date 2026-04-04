import Link from 'next/link';

import './globals.css';

export const metadata = {
  title: 'Zodiac Portal',
  description: 'Signup and live operations portal for the Zodiac Online server.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="topbar">
            <div className="brand-block">
              <p className="eyebrow">Zodiac Online</p>
              <Link className="brand" href="/signup">
                Portal
              </Link>
            </div>
            <nav className="topnav">
              <Link href="/signup">Signup</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
