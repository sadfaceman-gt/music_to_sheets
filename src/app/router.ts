import { useCallback, useEffect, useState } from 'react';

/** The screens, addressed by the URL hash so a reload keeps the screen. */
export type Route = { screen: 'projects' } | { screen: 'analysis'; id: string } | { screen: 'plan'; id: string } | { screen: 'editor' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === '/editor') return { screen: 'editor' };
  const plan = /^\/project\/([^/]+)\/plan$/.exec(h);
  const m = plan ?? /^\/project\/(.+)$/.exec(h);
  if (m?.[1]) {
    try {
      return { screen: plan ? 'plan' : 'analysis', id: decodeURIComponent(m[1]) };
    } catch {
      return { screen: 'projects' };
    }
  }
  return { screen: 'projects' };
}

export function routeHash(route: Route): string {
  if (route.screen === 'editor') return '#/editor';
  if (route.screen === 'analysis') return `#/project/${encodeURIComponent(route.id)}`;
  if (route.screen === 'plan') return `#/project/${encodeURIComponent(route.id)}/plan`;
  return '#/projects';
}

/** The project a route is about, or null. */
export function routeProjectId(route: Route): string | null {
  return route.screen === 'analysis' || route.screen === 'plan' ? route.id : null;
}

/** Current route from location.hash, and a navigate function that sets it. */
export function useRoute(): [Route, (route: Route) => void] {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((route: Route) => {
    location.hash = routeHash(route);
  }, []);
  return [parseHash(hash), navigate];
}
