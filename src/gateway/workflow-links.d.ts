import { YagrN8nConfigService } from '@yagr/plugin-n8n-manager';
import { ManagedN8nOwnerCredentialService } from '../n8n-local/owner-credentials.js';
export interface WorkflowOpenLink {
    openUrl: string;
    targetUrl: string;
    via: 'direct' | 'self-contained-auth';
}
export declare function resolveWorkflowOpenLink(workflowUrl: string, options?: {
    n8nConfigService?: YagrN8nConfigService;
    ownerCredentialService?: ManagedN8nOwnerCredentialService;
    /** When set, the public Cloudflare tunnel URL replaces the local origin in openUrl. */
    n8nTunnelPublicUrl?: string;
    /** Local n8n origin behind the tunnel, used to recover owner credentials. */
    n8nTunnelTargetUrl?: string;
}): WorkflowOpenLink;
//# sourceMappingURL=workflow-links.d.ts.map