export interface ManagedN8nOwnerCredentials {
    url: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    createdAt: string;
}
export declare class ManagedN8nOwnerCredentialService {
    private readonly store;
    constructor();
    get(url: string): ManagedN8nOwnerCredentials | undefined;
    save(credentials: ManagedN8nOwnerCredentials): ManagedN8nOwnerCredentials;
}
//# sourceMappingURL=owner-credentials.d.ts.map