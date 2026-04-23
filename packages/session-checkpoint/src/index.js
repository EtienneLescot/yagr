import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export function buildDeepAgentSessionConfig(sessionId) {
    return {
        configurable: { thread_id: sessionId },
    };
}
export function deriveSessionTitle(text, fallback = 'New conversation') {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return fallback;
    }
    return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77).trimEnd()}...`;
}
export class DeepAgentSessionStore {
    sessionsDir;
    constructor(sessionsDir) {
        this.sessionsDir = sessionsDir;
    }
    getSessionsDir() {
        return this.sessionsDir;
    }
    list() {
        this.ensureDir();
        const files = fs.readdirSync(this.sessionsDir).filter((file) => file.endsWith('.json') && !file.startsWith('.'));
        const results = [];
        for (const file of files) {
            const record = this.readRecord(path.join(this.sessionsDir, file));
            if (record) {
                results.push(record);
            }
        }
        return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    get(sessionId) {
        return this.readRecord(this.recordPath(sessionId));
    }
    create(options = {}) {
        const now = new Date().toISOString();
        const record = {
            id: options.id ?? randomUUID(),
            createdAt: now,
            updatedAt: now,
            title: options.title?.trim() || 'New conversation',
            ...(options.scope ? { scope: options.scope } : {}),
        };
        this.save(record);
        if (record.scope) {
            this.setActiveScope(record.scope, record.id);
        }
        return record;
    }
    ensure(sessionId, options = {}) {
        const existing = this.get(sessionId);
        if (existing) {
            let next = existing;
            if (options.scope && this.scopeChanged(existing.scope, options.scope)) {
                next = { ...next, scope: options.scope, updatedAt: new Date().toISOString() };
            }
            if (options.title && existing.title === 'New conversation') {
                next = { ...next, title: options.title.trim() || existing.title, updatedAt: new Date().toISOString() };
            }
            if (next !== existing) {
                this.save(next);
            }
            if (next.scope) {
                this.setActiveScope(next.scope, next.id);
            }
            return next;
        }
        return this.create({ id: sessionId, ...options });
    }
    touch(sessionId, options = {}) {
        const existing = this.get(sessionId);
        if (!existing) {
            return undefined;
        }
        const next = {
            ...existing,
            updatedAt: new Date().toISOString(),
        };
        if (options.title?.trim()) {
            next.title = options.title.trim();
        }
        if (options.closed) {
            next.closedAt = next.updatedAt;
        }
        this.save(next);
        return next;
    }
    getActiveForScope(scope) {
        const sessionId = this.readScopeState().activeByScopeKey?.[this.scopeKey(scope)];
        return sessionId ? this.get(sessionId) : undefined;
    }
    getOrCreateActiveForScope(scope, options = {}) {
        const existing = this.getActiveForScope(scope);
        if (existing) {
            return existing;
        }
        return this.create({
            title: options.title,
            scope,
        });
    }
    rotateActiveForScope(scope, options = {}) {
        const previous = this.getActiveForScope(scope);
        if (previous) {
            this.touch(previous.id, { closed: true });
        }
        return this.create({
            title: options.title,
            scope,
        });
    }
    clearActiveScope(scope) {
        const state = this.readScopeState();
        const key = this.scopeKey(scope);
        if (!state.activeByScopeKey?.[key]) {
            return;
        }
        const next = { ...(state.activeByScopeKey ?? {}) };
        delete next[key];
        this.writeScopeState({ activeByScopeKey: next });
    }
    delete(sessionId) {
        const filePath = this.recordPath(sessionId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        const state = this.readScopeState();
        const nextEntries = Object.entries(state.activeByScopeKey ?? {}).filter(([, value]) => value !== sessionId);
        this.writeScopeState({ activeByScopeKey: Object.fromEntries(nextEntries) });
    }
    async deleteThread(checkpointer, sessionId) {
        await checkpointer.deleteThread(sessionId);
    }
    save(record) {
        this.ensureDir();
        fs.writeFileSync(this.recordPath(record.id), JSON.stringify(record, null, 2), 'utf-8');
    }
    recordPath(sessionId) {
        return path.join(this.sessionsDir, `${sessionId}.json`);
    }
    scopeStatePath() {
        return path.join(this.sessionsDir, '.scopes.json');
    }
    setActiveScope(scope, sessionId) {
        const state = this.readScopeState();
        this.writeScopeState({
            activeByScopeKey: {
                ...(state.activeByScopeKey ?? {}),
                [this.scopeKey(scope)]: sessionId,
            },
        });
    }
    scopeKey(scope) {
        return `${scope.kind}:${scope.key}`;
    }
    scopeChanged(left, right) {
        return left?.kind !== right?.kind || left?.key !== right?.key;
    }
    readScopeState() {
        const filePath = this.scopeStatePath();
        if (!fs.existsSync(filePath)) {
            return {};
        }
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return {};
        }
    }
    writeScopeState(state) {
        this.ensureDir();
        fs.writeFileSync(this.scopeStatePath(), JSON.stringify(state, null, 2), 'utf-8');
    }
    readRecord(filePath) {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return undefined;
        }
    }
    ensureDir() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }
}
export class CheckpointManager {
    checkpointer;
    sessionsDir;
    constructor(checkpointer, sessionsDir) {
        this.checkpointer = checkpointer;
        this.sessionsDir = sessionsDir;
    }
    checkpointDir(sessionId) {
        return path.join(this.sessionsDir, sessionId, 'checkpoints');
    }
    checkpointPath(sessionId, checkpointId) {
        return path.join(this.checkpointDir(sessionId), checkpointId);
    }
    listCheckpointsSync(sessionId) {
        const dir = this.checkpointDir(sessionId);
        if (!fs.existsSync(dir)) {
            return [];
        }
        const checkpoints = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const metaPath = path.join(dir, entry.name, 'metadata.json');
            if (!fs.existsSync(metaPath))
                continue;
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                checkpoints.push(meta);
            }
            catch {
                // Skip invalid checkpoint metadata
            }
        }
        return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async getCheckpoint(sessionId, checkpointId) {
        const cpPath = this.checkpointPath(sessionId, checkpointId);
        const checkpointFile = path.join(cpPath, 'checkpoint.json');
        const metadataFile = path.join(cpPath, 'metadata.json');
        if (!fs.existsSync(checkpointFile) || !fs.existsSync(metadataFile)) {
            return undefined;
        }
        try {
            const tuple = JSON.parse(fs.readFileSync(checkpointFile, 'utf-8'));
            const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
            return { tuple, metadata };
        }
        catch {
            return undefined;
        }
    }
    async saveCheckpoint(sessionId) {
        const checkpointTuple = await this.checkpointer.getTuple({ configurable: { thread_id: sessionId } });
        if (!checkpointTuple) {
            throw new Error(`No checkpoint found for session ${sessionId}`);
        }
        const checkpointId = randomUUID();
        const now = new Date().toISOString();
        const cpPath = this.checkpointPath(sessionId, checkpointId);
        fs.mkdirSync(cpPath, { recursive: true });
        const metadata = {
            id: checkpointId,
            sessionId,
            createdAt: now,
            messageCount: this.countMessages(checkpointTuple.checkpoint),
        };
        fs.writeFileSync(path.join(cpPath, 'checkpoint.json'), JSON.stringify(checkpointTuple), 'utf-8');
        fs.writeFileSync(path.join(cpPath, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
        return metadata;
    }
    async restoreCheckpoint(sessionId, checkpointId) {
        const found = await this.getCheckpoint(sessionId, checkpointId);
        if (!found) {
            throw new Error(`Checkpoint ${checkpointId} not found for session ${sessionId}`);
        }
        const checkpointNamespace = found.tuple.config.configurable?.checkpoint_ns;
        const restoreConfig = this.buildRestoreConfig(sessionId, checkpointNamespace);
        const savedConfig = await this.checkpointer.put(restoreConfig, found.tuple.checkpoint, found.tuple.metadata ?? this.buildFallbackLangGraphMetadata(), {});
        await Promise.all(this.groupPendingWritesByTask(found.tuple.pendingWrites).map(([taskId, writes]) => this.checkpointer.putWrites(savedConfig, writes, taskId)));
    }
    async deleteCheckpoint(sessionId, checkpointId) {
        const cpPath = this.checkpointPath(sessionId, checkpointId);
        if (fs.existsSync(cpPath)) {
            fs.rmSync(cpPath, { recursive: true, force: true });
        }
    }
    async deleteAllCheckpoints(sessionId) {
        const dir = this.checkpointDir(sessionId);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    countMessages(channelData) {
        if (!channelData || typeof channelData !== 'object')
            return 0;
        const data = channelData;
        const channelValues = data.channel_values;
        if (channelValues && typeof channelValues === 'object') {
            const values = channelValues;
            if (Array.isArray(values.messages)) {
                return values.messages.length;
            }
            if (Array.isArray(values.channel_messages)) {
                return values.channel_messages.length;
            }
        }
        if (Array.isArray(data.messages)) {
            return data.messages.length;
        }
        if (Array.isArray(data.channel_messages)) {
            return data.channel_messages.length;
        }
        return 0;
    }
    buildRestoreConfig(sessionId, checkpointNamespace) {
        return {
            configurable: {
                thread_id: sessionId,
                ...(checkpointNamespace ? { checkpoint_ns: checkpointNamespace } : {}),
            },
        };
    }
    buildFallbackLangGraphMetadata() {
        return {
            source: 'fork',
            step: -1,
            parents: {},
        };
    }
    groupPendingWritesByTask(pendingWrites) {
        if (!pendingWrites?.length) {
            return [];
        }
        const writesByTask = new Map();
        for (const [taskId, channel, value] of pendingWrites) {
            const existing = writesByTask.get(taskId) ?? [];
            existing.push([channel, value]);
            writesByTask.set(taskId, existing);
        }
        return [...writesByTask.entries()];
    }
}
//# sourceMappingURL=index.js.map