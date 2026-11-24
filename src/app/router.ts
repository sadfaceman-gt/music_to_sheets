import { useCallback, useEffect, useState } from 'react';

/** The three screens, addressed by the URL hash so a reload keeps the screen. */
export type Route = { screen: 'projects' } | { screen: 'analysis'; id: string } | { screen: 'editor' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === '/editor') return { screen: 'editor' };
  const m = /^\/project\/(.+)$/.exec(h);
  if (m?.[1]) {
    try {
      return { screen: 'analysis', id: decodeURIComponent(m[1]) };
    } catch {
      return { screen: 'projects' };
    }
  }
  return { screen: 'projects' };
}

export function routeHash(route: Route): string {
  if (route.screen === 'editor') return '#/editor';
  if (route.screen === 'analysis') return `#/project/${encodeURIComponent(route.id)}`;
  return '#/projects';
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
