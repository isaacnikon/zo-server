export default function AdminPageFrame({
  eyebrow,
  title,
  description,
  sidebar,
  actions = null,
  message = null,
  children,
}) {
  return (
    <main className="admin-shell-page">
      <aside className="admin-sidebar-column">{sidebar}</aside>
      <div className="admin-content-column">
        <section className="panel admin-section-hero">
          <div className="admin-section-hero-topline">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p className="lede admin-section-lede">{description}</p>
            </div>
            {actions ? <div className="admin-section-actions">{actions}</div> : null}
          </div>
        </section>

        {message ? <p className={`status-banner ${message.tone}`}>{message.text}</p> : null}

        <div className="admin-content-stack">{children}</div>
      </div>
    </main>
  );
}
