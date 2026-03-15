import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowStateTracker } from '../../src/core/services/workflow-state-tracker.js';

describe('WorkflowStateTracker filename sanitization', () => {
    let tempDir: string | undefined;

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        tempDir = undefined;
    });

    function createTracker() {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8nac-tracker-'));
        return new WorkflowStateTracker({} as any, {
            directory: tempDir,
            syncInactive: false,
            ignoredTags: [],
            projectId: 'test-project'
        });
    }

    it('sanitizes Windows-invalid characters in workflow filenames', () => {
        const tracker = createTracker();

        expect((tracker as any).safeName('AI Assistant | Email Sender')).toBe('AI Assistant _ Email Sender');
        expect((tracker as any).safeName('db: backup <nightly>?*')).toBe('db_ backup _nightly___');
    });

    it('removes trailing dots and spaces and protects reserved device names', () => {
        const tracker = createTracker();

        expect((tracker as any).safeName('NUL')).toBe('NUL_');
        expect((tracker as any).safeName('report. ')).toBe('report');
        expect((tracker as any).safeName('   ')).toBe('workflow');
    });
});
