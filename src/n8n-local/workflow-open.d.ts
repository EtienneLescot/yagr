import { type ManagedN8nOwnerCredentials } from './owner-credentials.js';
export type ManagedWorkflowOpenPayload = {
    mode: 'direct';
    targetUrl: string;
} | {
    mode: 'managed';
    targetUrl: string;
    loginUrl: string;
    credentials: ManagedN8nOwnerCredentials;
    fallbackPage: string;
};
export type ManagedWorkflowOpenResolution = {
    ok: true;
    payload: ManagedWorkflowOpenPayload;
} | {
    ok: false;
    statusCode: number;
    error: string;
};
export declare function resolveManagedN8nWorkflowOpen(target: string): ManagedWorkflowOpenResolution;
//# sourceMappingURL=workflow-open.d.ts.map