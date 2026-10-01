import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Extraction } from '../api';
import { Workspace } from '../components/Workspace';

export function DetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState<Extraction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItem(null);
    setError(null);
    api.get(id!).then(setItem).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="alert error" role="alert">{error} <Link to="/history">Back to history</Link></div>;
  if (!item) return <p className="muted" role="status">Loading…</p>;
  return <Workspace initial={item} />;
}
