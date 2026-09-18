import {readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dateWindow, shanghaiDate} from '../../site/lib/domain.mjs';
import {fetchAllListings, fetchDetail, postJson} from './source.mjs';
import {kindOf, normalizeEvent} from './normalize.mjs';

const SOURCE = {url: 'https://www.career.zju.edu.cn/', label: '浙江大学就业信息网'};

async function readPrevious(path) {
  try {
    const prior = JSON.parse(await readFile(path, 'utf8'));
    if (prior?.schemaVersion !== 1 || !Array.isArray(prior.events)) throw new Error('Invalid existing snapshot');
    return prior;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path, snapshot) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {flag: 'wx'});
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function collectToFile({snapshotPath, now = new Date().toISOString(), post = postJson, detailFetcher = fetchDetail}) {
  const instant = new Date(now).toISOString();
  const window = dateWindow(shanghaiDate(instant));
  const previous = await readPrevious(snapshotPath);
  const {list, count} = await fetchAllListings({post, start: window.start, end: window.end});
  const inWindow = list.filter(item => item.startTimeFormat >= window.start && item.startTimeFormat <= window.end);
  const oldById = new Map(previous?.events.map(event => [event.id, event]) ?? []);
  const events = new Array(inWindow.length);
  let detailFailures = 0;
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(6, inWindow.length)}, async () => {
    while (cursor < inWindow.length) {
      const index = cursor++;
      const item = inWindow[index];
      let detail;
      try {
        detail = await detailFetcher(item);
        normalizeEvent(item, detail, oldById.get(`${kindOf(item.type)}:${item.id}`), instant);
      } catch {
        detail = undefined;
        detailFailures += 1;
      }
      const id = `${kindOf(item.type)}:${item.id}`;
      events[index] = normalizeEvent(item, detail, oldById.get(id), instant);
      oldById.delete(id);
    }
  }));
  for (const old of oldById.values()) {
    if (old.date >= window.start && old.date <= window.end) {
      events.push({...old, availability: old.availability === 'cancelled' ? 'cancelled' : 'missing'});
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date)
    || (a.startAt ?? '').localeCompare(b.startAt ?? '') || a.title.localeCompare(b.title));
  const snapshot = {
    schemaVersion: 1, generatedAt: instant, lastSuccessAt: instant,
    window, source: SOURCE,
    sync: {status: detailFailures ? 'partial' : 'ok', fetchedCount: count, detailFailures},
    events,
  };
  await atomicWrite(snapshotPath, snapshot);
  return snapshot;
}
