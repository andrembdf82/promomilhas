import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMonitoredGroups, createGroupMatcher } from './monitored-groups.js';

function withFile(text, run) {
  const dir = mkdtempSync(join(tmpdir(), 'airlert-groups-'));
  try {
    const file = join(dir, 'groups.txt');
    if (text !== null) writeFileSync(file, text);
    run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reads one group per line with BOM, CRLF, blank lines and duplicates', () => {
  withFile('\uFEFFMundo Plus #773\r\n\r\n  Ofertas [VIP]  \r\nMundo Plus #773\r\n', file => {
    assert.deepEqual(loadMonitoredGroups(file), ['Mundo Plus #773', 'Ofertas [VIP]']);
  });
});

test('matches configured names literally and supports old number spelling', () => {
  const matches = createGroupMatcher(['Mundo Plus #773', 'Ofertas [VIP]', 'Milhas + viagens']);
  for (const name of ['Mundo Plus 773', '✈ MUNDO PLUS #773 - Ofertas', 'Ofertas [VIP]', 'Milhas + viagens']) {
    assert.equal(matches({ isGroup: true, name }), true);
  }
  for (const name of ['Mundo Plus 7730', 'Mundo Plus 1773', 'Ofertas VIP', 'Milhas viagens']) {
    assert.equal(matches({ isGroup: true, name }), false);
  }
  assert.equal(matches({ isGroup: false, name: 'Ofertas [VIP]' }), false);
});

test('empty file matches no group; missing file fails instead of opening the filter', () => {
  withFile(' \n\r\n', file => {
    assert.equal(createGroupMatcher(loadMonitoredGroups(file))({ isGroup: true, name: 'Qualquer grupo' }), false);
  });
  withFile(null, file => assert.throws(() => loadMonitoredGroups(file), /Não foi possível ler/));
});
