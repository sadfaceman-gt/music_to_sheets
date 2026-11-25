/**
 * M2c: detection of key, chords and sections, and the Key, chord and section timeline (cycle 7, Design 5.5): every
 * timeline action with the mouse and keys, naming, rebinding, Finish analysis, saving, undo, and a cycle 6 project
 * migrating. One A B A B song is analysed once per browser and shared by the tests in order (CI time budget); each
 * test starts from its own timeline (set through the test hook, one undo step) so they don't depend on each other.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ana } from './helpers.ts';
import type { SectionLike } from './helpers.ts';
import { ABAB, ababChord, song44, songAbab } from './songs.ts';
import { chordName } from '../../src/core/analysis/music.ts';
import type { PitchClass } from '../../src/core/analysis/types.ts';
import type { Block, Chord, ChordBlock, KeyBlock, SectionBlock, Timeline } from '../../src/core/timeline/types.ts';

const BAR = (60 / ABAB.bpm) * ABAB.beatsPerBar;
const SECTION_SEC = BAR * ABAB.barsPerSection;
const KEY_ROW = 0;
const CHORD_ROW = 1;
const SECTION_ROW = 2;

/** Waits for the 2 s autosave, then reloads and waits for the (cached) analysis. */
async function saveAndReload(page: Page) {
  await page.waitForTimeout(2500);
  await page.reload();
  await ana.waitDone(page);
}

const G_MAJOR = { tonic: { letter: 'G' as const, accidental: '' as const }, mode: 'major' as const };
function chordOf(name: string): Chord {
  const minor = name.endsWith('m');
  return { kind: 'chord', root: { letter: name[0] as 'C', accidental: '' }, quality: minor ? 'min' : 'maj', extension: 'none', alterations: [], bass: null };
}

/** The song's bar times (the corrected grid's downbeats) and beats. */
interface Song {
  bars: number[];
  beats: number[];
  dur: number;
}

/**
 * A known timeline on the song's grid: one key block (G major), a chord block per bar (from 0 to the song's end) and
 * four 8-bar sections (verse, chorus, verse, chorus), all named and reviewed unless `unreviewed`.
 */
function fixture(s: Song, unreviewed = false): Timeline {
  let id = 1;
  const reviewed = !unreviewed;
  const key: KeyBlock[] = [{ id: id++, row: 'key', start: 0, end: s.dur, reviewed, name: G_MAJOR }];
  const edges = [0, ...s.bars.slice(1), s.dur];
  const chord: ChordBlock[] = edges.slice(0, -1).map((start, i) => ({ id: id++, row: 'chord', start, end: edges[i + 1]!, reviewed, name: chordOf(ababChord(Math.min(i, 31))) }));
  const sEdges = [0, s.bars[8]!, s.bars[16]!, s.bars[24]!, s.dur];
  const section: SectionBlock[] = sEdges.slice(0, -1).map((start, i) => ({ id: id++, row: 'section', start, end: sEdges[i + 1]!, reviewed, name: i % 2 === 0 ? 'verse' : 'chorus' }));
  return { key, chord, section, nextId: id };
}

const near = (a: number | undefined, b: number, eps = 0.02) => a !== undefined && Math.abs(a - b) <= eps;
const blockAt = (blocks: readonly Block[], t: number) => blocks.find((b) => b.start <= t + 1e-3 && t < b.end - 1e-3);

test.describe('A B A B song', () => {
  test.describe.configure({ mode: 'default', timeout: 180_000 });
  let page: Page;
  let song: Song;

  /** Sets the fixture (one undo step), clears the selection and waits for the rows to show it. */
  async function reset(unreviewed = false): Promise<Timeline> {
    const tl = fixture(song, unreviewed);
    await ana.setTimeline(page, tl);
    await page.keyboard.press('Escape');
    await expect.poll(() => ana.timeline(page)).toEqual(tl);
    return tl;
  }
  const pt = (row: number, t: number) => ana.rowPoint(page, row, t);
  async function clickAt(row: number, t: number, modifiers: ('Control' | 'Shift')[] = []) {
    const p = await pt(row, t);
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.click(p.x, p.y);
    for (const m of modifiers) await page.keyboard.up(m);
  }
  /** A real pointer drag from time a to time b on a row (optionally holding Shift, or with the right button). */
  async function dragAt(row: number, a: number, b: number, opts: { shift?: boolean; right?: boolean; dx?: number; toRow?: number } = {}) {
    const p = await pt(row, a);
    const q = await pt(opts.toRow ?? row, b);
    const dx = opts.dx ?? 0;
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.move(p.x + dx, p.y);
    await page.mouse.down({ button: opts.right ? 'right' : 'left' });
    await page.mouse.move(q.x + dx, q.y, { steps: 8 });
    await page.mouse.up({ button: opts.right ? 'right' : 'left' });
    if (opts.shift) await page.keyboard.up('Shift');
  }

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    page =await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
    await page.goto('./');
    await page.getByTestId('import-input').setInputFiles(songAbab());
    await page.getByTestId('analysis-screen').waitFor();
    await ana.waitDone(page);
    const g = (await ana.grid(page))!;
    const total = await page.getByTestId('time-total').textContent();
    const m = /(\d\d):(\d\d)\.(\d{3})$/.exec(total ?? '')!;
    const dur = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
    song = { bars: g.downbeats.map((i) => g.beats[i]!), beats: g.beats, dur };
  });
  test.afterAll(async () => {
    await page.close();
  });

  test('detection fills the three rows, Unreviewed, under the waveform', async () => {
    const tl = (await ana.timeline(page))!;
    expect(tl).not.toBeNull();
    expect(tl.key.length).toBeGreaterThanOrEqual(1);
    expect(tl.chord.length).toBeGreaterThan(10);
    expect(tl.section.length).toBeGreaterThanOrEqual(2);
    for (const b of [...tl.key, ...tl.chord, ...tl.section]) expect(b.reviewed).toBe(false);
    for (const row of ['key', 'chord', 'section']) await expect(page.getByTestId(`row-${row}`)).toBeVisible();
    const first = tl.section[0]!;
    await expect(page.getByTestId(`block-${first.id}`)).toHaveAttribute('data-reviewed', 'false');
    await expect(page.getByTestId(`block-${first.id}`)).toHaveAttribute('data-row', 'section');
    // The rows are as wide as the waveform and aligned with it.
    const wave = (await page.getByTestId('waveform-canvas').boundingBox())!;
    const rows = (await page.getByTestId('timeline-rows').boundingBox())!;
    expect(Math.abs(rows.x - wave.x)).toBeLessThan(2);
    expect(Math.abs(rows.width - wave.width)).toBeLessThan(3);
    await expect(page.getByTestId('key-info')).toHaveText(/^Key: /);
    // The old cycle 6 controls are gone.
    await expect(page.getByTestId('key-pick')).toHaveCount(0);
    await expect(page.getByTestId('section-timeline')).toHaveCount(0);
  });

  test('key, chords and sections are found (G major, the chords, A B A B)', async () => {
    await expect(page.getByTestId('key-info')).toContainText('G major');
    expect((await ana.songKey(page))?.name).toBe('G major');

    // At least 70% of the beats carry the generated chord.
    const g = (await ana.grid(page))!;
    const chords = await ana.chords(page);
    const at = (t: number) => chords.find((c) => c.start <= t + 1e-3 && t < c.end - 1e-3);
    let hits = 0;
    let total = 0;
    for (const t of g.beats) {
      const bar = Math.floor((t - ABAB.offset + 0.05) / BAR);
      if (bar < 0 || bar >= ABAB.barsPerSection * ABAB.sections) continue;
      total++;
      const c = at(t);
      if (c && chordName(c.root as PitchClass | null, c.quality) === ababChord(bar)) hits++;
    }
    expect(total).toBeGreaterThan(100);
    expect(hits / total).toBeGreaterThanOrEqual(0.7);

    // Boundaries within a bar of 16, 32 and 48 s (plus the offset); A and B in different clusters.
    const sections = await ana.sections(page);
    const starts = sections.slice(1).map((s) => s.start);
    for (let k = 1; k < ABAB.sections; k++) {
      const want = ABAB.offset + k * SECTION_SEC;
      expect(starts.some((b) => Math.abs(b - want) <= BAR + 0.05)).toBe(true);
    }
    const sectionAt = (t: number): SectionLike => sections.find((s) => s.start <= t && t < s.end)!;
    const mid = (k: number) => ABAB.offset + (k + 0.5) * SECTION_SEC;
    expect(sectionAt(mid(0)).cluster).not.toBe(sectionAt(mid(1)).cluster);
    expect(sectionAt(mid(2)).cluster).not.toBe(sectionAt(mid(3)).cluster);
  });

  test('pointer: move with trim, edge stretch, shared-edge drag with Shift (beats), right-drag create, box select', async () => {
    const tl = await reset(true);
    const { bars, beats } = song;
    const s2 = tl.section[1]!; // bars 8..16

    // Move the second section two bars earlier: it trims the first and leaves a gap after it.
    await dragAt(SECTION_ROW, (s2.start + s2.end) / 2, (s2.start + s2.end) / 2 - 2 * BAR);
    await expect.poll(async () => (await ana.timeline(page))!.section.find((b) => b.id === s2.id)?.start).toBeCloseTo(bars[6]!, 2);
    let now = (await ana.timeline(page))!;
    const moved = now.section.find((b) => b.id === s2.id)!;
    expect(near(moved.end, bars[14]!)).toBe(true);
    expect(moved.reviewed).toBe(true);
    expect(near(now.section.find((b) => b.id === tl.section[0]!.id)!.end, bars[6]!)).toBe(true);
    await expect(page.getByTestId(`block-${s2.id}`)).toHaveAttribute('data-selected', 'true');

    // Stretch its end (no neighbour touching) one bar later, into the gap.
    await dragAt(SECTION_ROW, bars[14]!, bars[15]!, { dx: -2 });
    await expect.poll(async () => (await ana.timeline(page))!.section.find((b) => b.id === s2.id)?.end).toBeCloseTo(bars[15]!, 2);

    // Shared edge of the first two chord blocks, two beats later with Shift: one shrinks, the other stretches.
    const [c1, c2] = tl.chord;
    const edgeBeat = beats.findIndex((b) => near(b, bars[1]!));
    await dragAt(CHORD_ROW, bars[1]!, beats[edgeBeat + 2]!, { shift: true });
    await expect.poll(async () => (await ana.timeline(page))!.chord.find((b) => b.id === c1!.id)?.end).toBeCloseTo(beats[edgeBeat + 2]!, 2);
    now = (await ana.timeline(page))!;
    expect(near(now.chord.find((b) => b.id === c2!.id)!.start, beats[edgeBeat + 2]!)).toBe(true);
    expect(near(now.chord.find((b) => b.id === c2!.id)!.end, bars[2]!)).toBe(true);

    // Delete the key block, then right-drag a new one in the empty key row (unnamed, reviewed, selected).
    await clickAt(KEY_ROW, 30);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await ana.timeline(page))!.key.length).toBe(0);
    await dragAt(KEY_ROW, bars[2]! + 0.1, bars[5]! - 0.1, { right: true });
    await expect.poll(async () => (await ana.timeline(page))!.key.length).toBe(1);
    const created = (await ana.timeline(page))!.key[0]!;
    expect(near(created.start, bars[2]!)).toBe(true);
    expect(near(created.end, bars[5]!)).toBe(true);
    expect(created.name).toBeNull();
    expect(created.reviewed).toBe(true);
    expect(await ana.selection(page)).toEqual([created.id]);
    await expect(page.getByTestId(`block-${created.id}`)).toHaveText('?');
    // A right-click without a drag clears the selection.
    await clickAt(CHORD_ROW, 40);
    expect((await ana.selection(page)).length).toBe(1);
    const p = await pt(CHORD_ROW, 40);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    expect(await ana.selection(page)).toEqual([]);

    // Box select from the empty key row (after the new block) down into the chord row, bars 10 to 13.
    await dragAt(KEY_ROW, bars[10]! + 0.5, bars[13]! - 0.5, { toRow: CHORD_ROW });
    now = (await ana.timeline(page))!;
    const want = now.chord.filter((b) => b.end > bars[10]! + 0.5 && b.start < bars[13]! - 0.5).map((b) => b.id);
    expect(want).toHaveLength(3);
    expect([...(await ana.selection(page))].sort((a, b) => a - b)).toEqual(want.sort((a, b) => a - b));
  });

  test('split (Split tool click), merge, Ctrl-click, arrow keys (bar; Shift: beat), delete, Escape', async () => {
    const tl = await reset(true);
    const { bars, beats } = song;
    const verse = tl.section[0]!;

    // Split the first section at the bar nearest the click.
    await page.getByTestId('tool-split').click();
    await expect(page.getByTestId('tool-split')).toHaveAttribute('aria-pressed', 'true');
    await clickAt(SECTION_ROW, bars[4]! + 0.3);
    await expect.poll(async () => (await ana.timeline(page))!.section.length).toBe(5);
    let now = (await ana.timeline(page))!;
    expect(near(now.section[0]!.end, bars[4]!)).toBe(true);
    expect(now.section[1]!.name).toBe('verse');
    await page.getByTestId('tool-select').click();

    // Ctrl-click the two halves and merge them back (named after the leftmost).
    await clickAt(SECTION_ROW, bars[1]!);
    await clickAt(SECTION_ROW, bars[6]!, ['Control']);
    expect((await ana.selection(page)).length).toBe(2);
    await page.getByTestId('tool-merge').click();
    await expect.poll(async () => (await ana.timeline(page))!.section.length).toBe(4);
    now = (await ana.timeline(page))!;
    expect(now.section[0]).toMatchObject({ id: verse.id, start: 0, name: 'verse' });
    expect(near(now.section[0]!.end, bars[8]!)).toBe(true);
    // Ctrl-click again removes a block from the selection.
    await clickAt(SECTION_ROW, bars[10]!, ['Control']);
    expect((await ana.selection(page)).length).toBe(2);
    await clickAt(SECTION_ROW, bars[10]!, ['Control']);
    expect(await ana.selection(page)).toEqual([verse.id]);

    // Arrow keys move a chord block a bar, Shift+arrow a beat.
    const c = tl.chord[5]!; // bar 5
    await clickAt(CHORD_ROW, (c.start + c.end) / 2);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await ana.timeline(page))!.chord.find((b) => b.id === c.id)?.start).toBeCloseTo(bars[6]!, 2);
    const b6 = beats.findIndex((b) => near(b, bars[6]!));
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await ana.timeline(page))!.chord.find((b) => b.id === c.id)?.start).toBeCloseTo(beats[b6 - 1]!, 2);

    // Delete leaves a gap; Escape clears the selection.
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await ana.timeline(page))!.chord.some((b) => b.id === c.id)).toBe(false);
    expect(await ana.selection(page)).toEqual([]);
    await clickAt(CHORD_ROW, bars[20]! + 0.5);
    expect((await ana.selection(page)).length).toBe(1);
    await page.keyboard.press('Escape');
    expect(await ana.selection(page)).toEqual([]);
  });

  test('copy, cut and paste over three rows keep rows, names and spacing', async () => {
    const tl = await reset();
    const { bars } = song;
    // Select one block in each row around bar 9 (section 2 starts there).
    await clickAt(CHORD_ROW, bars[9]! + 0.5);
    await clickAt(SECTION_ROW, bars[9]! + 0.5, ['Control']);
    await clickAt(KEY_ROW, bars[9]! + 0.5, ['Control']);
    expect((await ana.selection(page)).length).toBe(3);
    const key = tl.key[0]!;
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await ana.timeline(page))!.key.length).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await ana.timeline(page))!.key.length).toBe(1);

    // Copy the chord of bar 9 and the second section only (two rows), paste at bar 24 by hovering there.
    await clickAt(CHORD_ROW, bars[9]! + 0.5);
    await clickAt(SECTION_ROW, bars[9]! + 0.5, ['Control']);
    await page.keyboard.press('Control+c');
    const hover = await pt(CHORD_ROW, bars[24]! + 0.2);
    await page.mouse.move(hover.x, hover.y);
    await page.keyboard.press('Control+v');
    // The earliest copied block (the section, from bar 8) lands on bar 24; the chord keeps its one-bar offset.
    await expect.poll(async () => (await ana.timeline(page))!.section.filter((b) => near(b.start, bars[24]!)).length).toBe(1);
    let now = (await ana.timeline(page))!;
    const pastedSection = blockAt(now.section, bars[24]! + 0.5)!;
    expect(pastedSection).toMatchObject({ name: 'chorus', reviewed: true });
    expect(near(pastedSection.end, Math.min(song.dur, bars[24]! + (tl.section[1]!.end - tl.section[1]!.start)))).toBe(true);
    const pastedChord = blockAt(now.chord, bars[25]! + 0.5)!;
    expect(near(pastedChord.start, bars[25]!)).toBe(true);
    expect(pastedChord.name).toEqual(tl.chord[9]!.name); // never transposed
    expect(now.key).toEqual([key]);
    expect((await ana.selection(page)).length).toBe(2);

    // Cut: the selection goes, leaving gaps, and pastes back where the pointer is not over the rows (the playhead, 0).
    await page.keyboard.press('Control+x');
    await expect.poll(async () => (await ana.timeline(page))!.section.some((b) => b.id === pastedSection.id)).toBe(false);
    expect(await ana.selection(page)).toEqual([]);
    now = (await ana.timeline(page))!;
    expect(blockAt(now.section, bars[24]! + 0.5)).toBeUndefined();
    await page.mouse.move(5, 5);
    await page.getByTestId('tool-paste').click();
    await expect.poll(async () => blockAt((await ana.timeline(page))!.section, 0.1)?.name).toBe('chorus');
  });

  test('naming: section buttons, key select, chord dropdowns, Write chord name; naming off over two rows', async () => {
    const tl = await reset(true);
    const { bars } = song;
    // Sections.
    await clickAt(SECTION_ROW, bars[2]!);
    await page.getByTestId('name-section-bridge').click();
    await expect.poll(async () => (await ana.timeline(page))!.section[0]).toMatchObject({ name: 'bridge', reviewed: true });
    await expect(page.getByTestId(`block-${tl.section[0]!.id}`)).toHaveText('bridge');
    // Two rows: naming is off.
    await clickAt(CHORD_ROW, bars[2]! + 0.5, ['Control']);
    await expect(page.getByTestId('naming-disabled')).toBeVisible();
    await expect(page.getByTestId('name-section-bridge')).toHaveCount(0);

    // Keys.
    await clickAt(KEY_ROW, 10);
    await page.getByTestId('name-key').selectOption({ label: 'E minor' });
    await expect(page.getByTestId('key-info')).toHaveText('Key: E minor');
    expect((await ana.timeline(page))!.key[0]!.name).toEqual({ tonic: { letter: 'E', accidental: '' }, mode: 'minor' });

    // Chord dropdowns on two chord blocks: D minor, then a disabled combination (b9 needs a seventh).
    const c3 = tl.chord[3]!;
    const c4 = tl.chord[4]!;
    await clickAt(CHORD_ROW, (c3.start + c3.end) / 2);
    await clickAt(CHORD_ROW, (c4.start + c4.end) / 2, ['Control']);
    await page.getByTestId('chord-root').selectOption({ label: 'D' });
    await page.getByTestId('chord-quality').selectOption('min');
    await expect(page.getByTestId('chord-preview')).toHaveText('Dm');
    await expect(page.getByTestId('chord-alt-b9')).toBeDisabled();
    await page.getByTestId('chord-extension').selectOption('7');
    await expect(page.getByTestId('chord-preview')).toHaveText('Dm7');
    await expect(page.getByTestId(`block-${c4.id}`)).toHaveText('Dm7');
    await page.getByTestId('chord-bass').selectOption({ label: 'F' });
    await expect(page.getByTestId('chord-preview')).toHaveText('Dm7/F');
    await page.getByTestId('chord-none').click();
    await expect(page.getByTestId(`block-${c3.id}`)).toHaveText('N.C.');

    // Write chord name: accepts D/F#, refuses /F#d/Dmin2 and changes nothing; shortcuts are off while it is on.
    await page.getByTestId('write-chord-toggle').check();
    await page.getByTestId('chord-input').fill('D/F#');
    await page.getByTestId('chord-input').press('Enter');
    await expect(page.getByTestId(`block-${c3.id}`)).toHaveText('D/F♯');
    await expect(page.getByTestId(`block-${c4.id}`)).toHaveText('D/F♯');
    const before = await ana.timeline(page);
    await page.getByTestId('chord-input').fill('/F#d/Dmin2');
    await page.getByTestId('chord-input').press('Enter');
    await expect(page.getByTestId('chord-error')).toBeVisible();
    expect(await ana.timeline(page)).toEqual(before);
    // Clicking a block still selects; B (Split), Delete and Ctrl+Z do nothing.
    await clickAt(CHORD_ROW, bars[12]! + 0.5);
    expect((await ana.selection(page)).length).toBe(1);
    await page.keyboard.press('b');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('tool-split')).toHaveAttribute('aria-pressed', 'false');
    expect(await ana.timeline(page)).toEqual(before);
    await page.getByTestId('write-chord-toggle').uncheck();
    await page.keyboard.press('b');
    await expect(page.getByTestId('tool-split')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('v');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('rebinding a tool key; Escape while binding removes it', async () => {
    await reset();
    await expect(page.getByTestId('tool-key-select')).toHaveText('V');
    await expect(page.getByTestId('tool-key-delete')).toHaveCount(0);
    await page.getByTestId('tool-delete').click({ button: 'right' });
    await page.keyboard.press('q');
    await expect(page.getByTestId('tool-key-delete')).toHaveText('Q');
    await clickAt(CHORD_ROW, song.bars[3]! + 0.5);
    const id = (await ana.selection(page))[0]!;
    await page.keyboard.press('q');
    await expect.poll(async () => (await ana.timeline(page))!.chord.some((b) => b.id === id)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('mts.timelineShortcuts'))).toContain('tool:delete');
    await page.getByTestId('tool-delete').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-key-delete')).toHaveCount(0);
  });

  test('Finish analysis: refuses with highlights, passes after fixes, the unreviewed warning, (finished), an edit clears it', async () => {
    const tl = fixture(song);
    const { bars, beats } = song;
    // A gap in the chords (bar 3 removed), an unnamed key block, a section edge a beat off its bar.
    const b16 = beats.findIndex((b) => near(b, bars[16]!));
    const bad: Timeline = {
      ...tl,
      key: [{ ...tl.key[0]!, name: null }],
      chord: tl.chord.filter((_, i) => i !== 3),
      section: tl.section.map((s, i) => (i === 1 ? { ...s, end: beats[b16 + 1]! } : i === 2 ? { ...s, start: beats[b16 + 1]! } : s)),
    };
    await ana.setTimeline(page, bad);
    await page.getByTestId('finish-analysis').click();
    const report = page.getByTestId('finish-report');
    await expect(report).toBeVisible();
    await expect(report).toContainText('Gap in Chords');
    await expect(report).toContainText('Unnamed key block at 0:00');
    await expect(report).toContainText('Section edge off a bar');
    await expect(page.getByTestId('gap-chord-0')).toBeVisible();
    await expect(page.getByTestId(`block-${tl.key[0]!.id}`)).toHaveAttribute('data-problem', 'true');
    await expect(page.getByTestId(`block-${tl.section[1]!.id}`)).toHaveAttribute('data-problem', 'true');
    expect(await ana.finishedAt(page)).toBeNull();
    // Clicking a problem selects its block.
    const items = page.locator('[data-testid^="finish-problem-"]');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      if (!(await items.nth(i).textContent())?.startsWith('Unnamed key')) continue;
      await items.nth(i).click();
      expect(await ana.selection(page)).toEqual([tl.key[0]!.id]);
    }

    // Fix them (some blocks still unreviewed): the report empties, then Finish warns about the unreviewed blocks.
    await ana.setTimeline(page, { ...fixture(song), chord: fixture(song, true).chord });
    await expect(page.locator('[data-testid^="finish-problem-"]')).toHaveCount(0);
    await expect(page.getByTestId('gap-chord-0')).toHaveCount(0);
    await page.getByTestId('finish-analysis').click();
    await expect(page.getByTestId('finish-warning')).toContainText(`${tl.chord.length} blocks are still unreviewed`);
    await page.getByTestId('finish-cancel').click();
    expect(await ana.finishedAt(page)).toBeNull();
    await page.getByTestId('finish-analysis').click();
    await page.getByTestId('finish-anyway').click();
    await expect(page.getByTestId('finished-badge')).toBeVisible();
    await expect(page.getByTestId('step-analysis')).toHaveText('2 Import and analysis (finished)');
    expect(await ana.finishedAt(page)).not.toBeNull();

    // It survives a reload; then a timeline edit clears it, and so does a beat correction.
    await saveAndReload(page);
    await expect(page.getByTestId('finished-badge')).toBeVisible();
    await expect(page.getByTestId('step-analysis')).toHaveText('2 Import and analysis (finished)');
    await clickAt(SECTION_ROW, bars[2]!);
    await page.getByTestId('tool-reviewed').click();
    await expect(page.getByTestId('finished-badge')).toHaveCount(0);
    await expect(page.getByTestId('step-analysis')).toHaveText('2 Import and analysis (analysed)');
    expect(await ana.finishedAt(page)).toBeNull();

    // All reviewed and no problems: Finish passes at once. A beat correction clears it.
    await reset();
    await page.getByTestId('finish-analysis').click();
    await expect(page.getByTestId('finished-badge')).toBeVisible();
    await page.getByTestId('nudge-p10').click();
    await expect(page.getByTestId('finished-badge')).toHaveCount(0);
    await page.getByTestId('undo-correction').click();
  });

  test('edits survive a reload; undo and redo of a drag (buttons and keys)', async () => {
    await reset(true);
    const { bars } = song;
    const s3 = fixture(song).section[2]!;
    const before = (await ana.timeline(page))!;
    await dragAt(SECTION_ROW, (s3.start + s3.end) / 2, (s3.start + s3.end) / 2 + BAR);
    await expect.poll(async () => (await ana.timeline(page))!.section.find((b) => b.id === s3.id)?.start).toBeCloseTo(bars[17]!, 2);
    const after = (await ana.timeline(page))!;
    await page.getByTestId('undo-correction').click();
    expect(await ana.timeline(page)).toEqual(before);
    await page.getByTestId('redo-correction').click();
    expect(await ana.timeline(page)).toEqual(after);
    await page.keyboard.press('Control+z');
    expect(await ana.timeline(page)).toEqual(before);
    await page.keyboard.press('Control+Shift+Z');
    expect(await ana.timeline(page)).toEqual(after);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    expect(await ana.timeline(page)).toEqual(after);

    await saveAndReload(page);
    expect(await ana.timeline(page)).toEqual(after);
    await expect(page.getByTestId(`block-${s3.id}`)).toHaveAttribute('data-reviewed', 'true');
    await expect(page.getByTestId('undo-correction')).toBeDisabled();
  });

  test('the level override (x2) on a selected section: a range correction, undone with the same history', async () => {
    await reset();
    const g0 = (await ana.grid(page))!;
    const s = fixture(song).section[1]!;
    await clickAt(SECTION_ROW, (s.start + s.end) / 2);
    await page.getByTestId('tool-double').click();
    expect(await ana.corrections(page)).toEqual([{ kind: 'range', start: s.start, end: s.end, op: 'double' }]);
    const g1 = (await ana.grid(page))!;
    const inside = (beats: number[]) => beats.filter((t) => t >= s.start - 1e-3 && t < s.end - 1e-3).length;
    expect(inside(g1.beats) / inside(g0.beats)).toBeGreaterThan(1.8);
    // Blocks keep their times when the grid changes.
    expect((await ana.timeline(page))!.section[1]).toMatchObject({ start: s.start, end: s.end });
    await page.getByTestId('undo-correction').click();
    expect(await ana.grid(page)).toEqual(g0);
  });

  test('switching trackers keeps the timeline', async () => {
    const tl = await reset();
    await page.waitForTimeout(2500);
    await page.getByTestId('tracker-dsp').click();
    await ana.waitDone(page);
    await expect.poll(() => ana.tracker(page)).toBe('dsp');
    expect(await ana.timeline(page)).toEqual(tl);
    await page.getByTestId('tracker-beatthis-small0').click();
    await ana.waitDone(page);
    await expect.poll(() => ana.tracker(page)).toBe('beatthis-small0');
    expect(await ana.timeline(page)).toEqual(tl);
  });
});

test('re-run counts the corrections and the timeline, then refills the timeline (short song)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(song44());
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
  const seeded = (await ana.timeline(page))!;
  await page.getByTestId('double-tempo').click();
  // Mark one block reviewed.
  const first = seeded.section[0]!;
  await page.getByTestId(`block-${first.id}`).click();
  await page.getByTestId('tool-reviewed').click();
  await page.getByTestId('rerun-analysis').click();
  await expect(page.getByTestId('confirm-rerun')).toContainText('Re-running discards your 1 correction and your timeline (1 reviewed block)');
  await page.getByRole('button', { name: 'Keep' }).click();
  expect((await ana.timeline(page))!.section[0]!.reviewed).toBe(true);
  await page.getByTestId('rerun-analysis').click();
  await page.getByTestId('confirm-rerun-yes').click();
  await ana.waitDone(page);
  await expect.poll(() => ana.corrections(page)).toEqual([]);
  const refilled = (await ana.timeline(page))!;
  expect([...refilled.key, ...refilled.chord, ...refilled.section].every((b) => !b.reviewed)).toBe(true);
  await expect(page.getByTestId('undo-correction')).toBeDisabled();
  await saveAndReload(page);
  expect(await ana.timeline(page)).toEqual(refilled);
});

test('a cycle 6 project (schema v3) opens as v4: its key pick is one key block, its section edits are applied', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(song44());
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
  const sections = await ana.sections(page);
  await page.waitForTimeout(500);
  // Rewrite the stored row as a cycle 6 record: no timeline, a key pick and a rename on the shown tracker.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('mts');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const row of all.result as Record<string, unknown>[]) {
              row.schemaVersion = 3;
              delete row.timeline;
              delete row.legacyEdits;
              delete row.finishedAt;
              const trackers = row.trackers as Record<string, Record<string, unknown>>;
              for (const t of Object.values(trackers)) {
                t.keyOverride = null;
                t.sectionEdits = [];
              }
              trackers[row.tracker as string]!.keyOverride = { tonic: 4, mode: 'minor' };
              trackers[row.tracker as string]!.sectionEdits = [{ kind: 'rename', at: 0.5, label: 'bridge' }];
              store.put(row);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await ana.waitDone(page);
  const tl = (await ana.timeline(page))!;
  expect(tl.key).toHaveLength(1);
  expect(tl.key[0]).toMatchObject({ start: 0, name: { tonic: { letter: 'E', accidental: '' }, mode: 'minor' }, reviewed: false });
  await expect(page.getByTestId('key-info')).toHaveText('Key: E minor');
  expect(tl.section).toHaveLength(sections.length);
  expect(tl.section[0]!.name).toBe('bridge');
  await page.getByTestId('nudge-p10').click();
  await page.waitForTimeout(2500);
  const stored = await page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('mts');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('projects').objectStore('projects').getAll();
          all.onsuccess = () => {
            const row = (all.result as Record<string, unknown>[])[0]!;
            open.result.close();
            resolve(row);
          };
        };
      }),
  );
  expect(stored.schemaVersion).toBe(4);
  expect(stored.legacyEdits).toBeNull();
  expect(stored.timeline).toEqual(tl);
});
