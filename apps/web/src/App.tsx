import { useEffect, useState } from 'react';
import { Voysy } from './pages/Voysy';
import { Oysterman } from './pages/Oysterman';
import { Scan } from './pages/Scan';

type Route = '/voysy' | '/oysterman' | '/scan';

function currentRoute(): Route {
  const p = window.location.pathname;
  if (p.startsWith('/oysterman')) return '/oysterman';
  if (p.startsWith('/scan')) return '/scan';
  return '/voysy';
}

export function navigate(to: Route) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="app">
      <nav className="nav">
        <NavLink to="/scan" active={route === '/scan'} label="Oyscan" sub="海を診る" />
        <NavLink to="/voysy" active={route === '/voysy'} label="Voysy" sub="海で記録する" />
        <NavLink to="/oysterman" active={route === '/oysterman'} label="AI Oysterman" sub="海から学ぶ" />
      </nav>
      <main className="main">
        {route === '/voysy' && <Voysy />}
        {route === '/oysterman' && <Oysterman />}
        {route === '/scan' && <Scan />}
      </main>
    </div>
  );
}

function NavLink({ to, active, label, sub }: { to: Route; active: boolean; label: string; sub: string }) {
  return (
    <a
      href={to}
      className={'nav-link' + (active ? ' active' : '')}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      <span className="nav-label">{label}</span>
      <span className="nav-sub">{sub}</span>
    </a>
  );
}
