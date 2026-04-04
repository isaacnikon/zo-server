export default function AdminSignOutForm() {
  return (
    <form action="/api/admin/session/logout" method="post">
      <button className="secondary-button" type="submit">
        Sign Out
      </button>
    </form>
  );
}
