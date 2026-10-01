import { Link, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { DetailPage } from './pages/DetailPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NewPage } from './pages/NewPage';

function Layout() {
  const { user, loading, signOut } = useAuth();
  if (loading) return <p className="center muted" role="status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">Ticket Extractor</Link>
        <nav>
          <NavLink to="/" end>New</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <span className="spacer" />
        <span className="muted small">{user.email}</span>
        <button className="link" onClick={signOut}>Sign out</button>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<NewPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/e/:id" element={<DetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
