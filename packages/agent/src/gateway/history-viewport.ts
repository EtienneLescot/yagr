export interface HistoryEntryLike {
  title: string;
  text: string;
}

export interface HistoryViewport<T extends HistoryEntryLike> {
  entries: T[];
  hasOlder: boolean;
  hasNewer: boolean;
  hiddenOlderCount: number;
  hiddenNewerCount: number;
}

const MIN_WIDTH = 12;

function estimateWrappedLines(text: string, width: number): number {
  const safeWidth = Math.max(MIN_WIDTH, width);

  return text.split('\n').reduce((total, line) => {
    const lineLength = line.length === 0 ? 1 : line.length;
    return total + Math.max(1, Math.ceil(lineLength / safeWidth));
  }, 0);
}

export function estimateHistoryEntryHeight(entry: HistoryEntryLike, width: number): number {
  const safeWidth = Math.max(MIN_WIDTH, width - 4);
  const titleLines = estimateWrappedLines(entry.title, safeWidth);
  const bodyLines = estimateWrappedLines(entry.text, safeWidth);

  return titleLines + bodyLines + 2;
}

export function selectHistoryEntries<T extends HistoryEntryLike>(
  entries: T[],
  width: number,
  maxHeight: number,
  offsetFromLatest: number,
): HistoryViewport<T> {
  if (entries.length === 0 || maxHeight <= 0) {
    return {
      entries: [],
      hasOlder: false,
      hasNewer: false,
      hiddenOlderCount: 0,
      hiddenNewerCount: 0,
    };
  }

  const clampedOffset = Math.max(0, Math.min(offsetFromLatest, entries.length - 1));
  const endExclusive = Math.max(1, entries.length - clampedOffset);
  const selected: T[] = [];
  let usedHeight = 0;
  let startIndex = endExclusive;

  for (let index = endExclusive - 1; index >= 0; index -= 1) {
    const nextEntry = entries[index];
    const nextHeight = estimateHistoryEntryHeight(nextEntry, width);

    if (selected.length > 0 && usedHeight + nextHeight > maxHeight) {
      break;
    }

    selected.unshift(nextEntry);
    usedHeight += nextHeight;
    startIndex = index;

    if (usedHeight >= maxHeight) {
      break;
    }
  }

  return {
    entries: selected,
    hasOlder: startIndex > 0,
    hasNewer: endExclusive < entries.length,
    hiddenOlderCount: startIndex,
    hiddenNewerCount: entries.length - endExclusive,
  };
}