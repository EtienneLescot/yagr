import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractWorkflowMapHeader, resolveWorkflowDiagram } from '../dist/tools/present-workflow-result.js';

test('extractWorkflowMapHeader returns the workflow-map block when present', () => {
  const source = [
    "import { workflow } from '@n8n-as-code/transformer';",
    '',
    '// <workflow-map>',
    '// Workflow : Demo',
    '// ROUTING MAP',
    '// Start',
    '// </workflow-map>',
    '',
    '@workflow({ id: \'abc123\', name: \'Demo\' })',
  ].join('\n');

  assert.equal(
    extractWorkflowMapHeader(source),
    ['<workflow-map>', '// Workflow : Demo', '// ROUTING MAP', '// Start', '// </workflow-map>'].join('\n'),
  );
});

test('resolveWorkflowDiagram prefers the local workflow file header over a fallback diagram', () => {
  const previousHome = process.env.YAGR_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-card-'));
  const workflowsDir = path.join(tempRoot, 'workflows', 'personal');
  fs.mkdirSync(workflowsDir, { recursive: true });

  const workflowPath = path.join(workflowsDir, 'exotic-space-music.workflow.ts');
  fs.writeFileSync(workflowPath, [
    "import { workflow } from '@n8n-as-code/transformer';",
    '',
    '// <workflow-map>',
    '// Workflow : Exotic Space Music Curator',
    '// ROUTING MAP',
    '// ScheduleTrigger',
    '//   -> NasaApotd',
    '// </workflow-map>',
    '',
    "@workflow({ id: 'fkRkvWeyurOyhZ5H', name: 'Exotic Space Music Curator' })",
  ].join('\n'));

  process.env.YAGR_HOME = tempRoot;

  try {
    assert.equal(
      resolveWorkflowDiagram('fkRkvWeyurOyhZ5H', '/**\n * stale diagram\n */'),
      ['<workflow-map>', '// Workflow : Exotic Space Music Curator', '// ROUTING MAP', '// ScheduleTrigger', '//   -> NasaApotd', '// </workflow-map>'].join('\n'),
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});