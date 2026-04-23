import fs from 'node:fs';
import path from 'node:path';
export class WebUiSessionRegistry {
    sessionsDir;
    constructor(sessionsDir) {
        this.sessionsDir = sessionsDir;
    }
    list() {
        this.ensureDir();
        const files = fs.readdirSync(this.sessionsDir).filter((file) => file.endsWith('.json'));
        const results = [];
        for (const file of files) {
            const session = this.readFile(path.join(this.sessionsDir, file));
            if (session) {
                results.push(this.toSummary(session));
            }
        }
        return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    get(sessionId) {
        return this.readFile(this.sessionPath(sessionId));
    }
    createEmpty(sessionId) {
        const now = new Date().toISOString();
        this.save({
            id: sessionId,
            title: 'New conversation',
            createdAt: now,
            updatedAt: now,
        });
    }
    save(session) {
        this.ensureDir();
        fs.writeFileSync(this.sessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
    }
    delete(sessionId) {
        const filePath = this.sessionPath(sessionId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
    setTitle(sessionId, title) {
        const session = this.get(sessionId);
        if (!session)
            return;
        this.save({ ...session, title, updatedAt: new Date().toISOString() });
    }
    setDisplayThread(sessionId, displayThread) {
        const session = this.get(sessionId);
        if (!session)
            return;
        this.save({ ...session, displayThread, updatedAt: new Date().toISOString() });
    }
    clearDisplayThread(sessionId) {
        const session = this.get(sessionId);
        if (!session)
            return;
        this.save({ ...session, displayThread: [], updatedAt: new Date().toISOString() });
    }
    toSummary(session) {
        return {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.displayThread?.length ?? 0,
        };
    }
    sessionPath(sessionId) {
        return path.join(this.sessionsDir, `${sessionId}.json`);
    }
    readFile(filePath) {
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
        const legacyStatePath = path.join(this.sessionsDir, '.state.json');
        if (fs.existsSync(legacyStatePath)) {
            try {
                fs.unlinkSync(legacyStatePath);
            }
            catch {
                // Ignore cleanup failures.
            }
        }
    }
}
//# sourceMappingURL=index.js.map