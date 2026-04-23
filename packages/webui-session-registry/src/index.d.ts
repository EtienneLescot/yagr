export interface SessionSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
}
export interface WebUiSession {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    displayThread?: unknown[];
}
export declare class WebUiSessionRegistry {
    private readonly sessionsDir;
    constructor(sessionsDir: string);
    list(): SessionSummary[];
    get(sessionId: string): WebUiSession | undefined;
    createEmpty(sessionId: string): void;
    save(session: WebUiSession): void;
    delete(sessionId: string): void;
    setTitle(sessionId: string, title: string): void;
    setDisplayThread(sessionId: string, displayThread: unknown[]): void;
    clearDisplayThread(sessionId: string): void;
    private toSummary;
    private sessionPath;
    private readFile;
    private ensureDir;
}
//# sourceMappingURL=index.d.ts.map