#!/usr/bin/env node
// Done check for "no game facts in code" (CLAUDE.md hard rule, Design 2.8).
// Scans src/ (except src/core/profile/, which loads the profile) for values that
// belong in public/profiles/growtopia-default.json. Exit code 1 lists every hit.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const profile = JSON.parse(readFileSync(join(root, 'public/profiles/growtopia-default.json'), 'utf8'));

const instrumentKeys = Object.keys(profile.instruments);
const codes = Object.values(profile.instruments).map((i) => i.code).filter(Boolean);
const accChars = Object.values(profile.gear.textAccidentals).map((c) => c.replace(/[-#]/g, '\\$&'));
const numbers = new Set([
  profile.grid.worldCols, profile.grid.pageCols,
  ...Object.values(profile.instruments).map((i) => i.baseMidi).filter((n) => n !== undefined),
]);

const checks = [
  { name: 'instrument id', re: new RegExp(`['"\`](${instrumentKeys.join('|')})['"\`]`) },
  { name: 'Gear note literal', re: new RegExp(`['"\`](${codes.join('|')})[a-gA-G][${accChars.join('')}]`) },
  { name: 'grid size / base note number', re: new RegExp(`(?<![\\w.#-])(${[...numbers].join('|')})(?![\\w.%-])`) },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const hits = [];
for (const file of files(join(root, 'src'))) {
  const rel = relative(root, file);
  if (rel.startsWith('src/core/profile/')) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const code = line
      .replace(/\/\/.*$/, '')
      .replace(/^\s*\*.*$/, '') // ignore comments
      .replace(/(rgba?|hsla?)\([^)]*\)/g, ''); // and colour values
    for (const c of checks) if (c.re.test(code)) hits.push(`${rel}:${i + 1}  ${c.name}: ${line.trim()}`);
  });
}

if (hits.length) {
  console.error(`Game facts hard-coded in src/ (move them to the Game Profile):\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('check-game-facts: no game facts found in src/');
