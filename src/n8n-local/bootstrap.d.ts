import { ManagedN8nOwnerCredentialService, type ManagedN8nOwnerCredentials } from './owner-credentials.js';
export interface SilentManagedN8nBootstrapResult {
    mode: 'silent' | 'assisted';
    apiKey?: string;
    ownerCredentials?: ManagedN8nOwnerCredentials;
    reason?: string;
}
export declare function bootstrapManagedLocalN8n(options: {
    url: string;
    ownerCredentialService?: ManagedN8nOwnerCredentialService;
}): Promise<SilentManagedN8nBootstrapResult>;
//# sourceMappingURL=bootstrap.d.ts.map