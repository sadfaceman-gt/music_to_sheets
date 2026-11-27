import { describe, expect, it } from 'vitest';
import { parseHash, routeHash, routeProjectId } from '../../src/app/router.ts';

describe('routes', () => {
  it('reads and writes every screen, the Plan step included', () => {
    expect(parseHash('#/project/abc/plan')).toEqual({ screen: 'plan', id: 'abc' });
    expect(parseHash('#/project/abc')).toEqual({ screen: 'analysis', id: 'abc' });
    expect(parseHash('#/editor')).toEqual({ screen: 'editor' });
    expect(parseHash('')).toEqual({ screen: 'projects' });
    for (const r of [{ screen: 'plan', id: 'a b/c' }, { screen: 'analysis', id: 'x' }, { screen: 'editor' }, { screen: 'projects' }] as const) {
      expect(parseHash(routeHash(r))).toEqual(r);
    }
    expect(routeProjectId({ screen: 'plan', id: 'p' })).toBe('p');
    expect(routeProjectId({ screen: 'editor' })).toBeNull();
  });
});
