import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateHistoryEntryHeight, selectHistoryEntries } from '../dist/gateway/history-viewport.js';

test('history viewport estimates a taller height for longer entries', () => {
  const shortHeight = estimateHistoryEntryHeight({ title: 'Short', text: 'Tiny line.' }, 40);
  const tallHeight = estimateHistoryEntryHeight({ title: 'Long', text: 'This is a much longer line that should wrap across multiple rows in the viewport.' }, 20);

  assert.ok(tallHeight > shortHeight);
});

test('history viewport anchors to latest entries by default', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    title: `Entry ${index + 1}`,
    text: `Payload ${index + 1}`,
  }));

  const viewport = selectHistoryEntries(entries, 50, 8, 0);

  assert.ok(viewport.entries.length > 0);
  assert.equal(viewport.entries.at(-1)?.title, 'Entry 6');
  assert.equal(viewport.hasNewer, false);
});

test('history viewport can scroll toward older entries while tracking hidden newer ones', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({
    title: `Entry ${index + 1}`,
    text: `Payload ${index + 1}`,
  }));

  const viewport = selectHistoryEntries(entries, 50, 8, 3);

  assert.ok(viewport.entries.length > 0);
  assert.ok(viewport.hiddenNewerCount > 0);
  assert.equal(viewport.entries.at(-1)?.title, 'Entry 5');
});