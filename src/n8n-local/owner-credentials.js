import Conf from 'conf';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
export class ManagedN8nOwnerCredentialService {
    store;
    constructor() {
        const paths = getYagrPaths();
        ensureYagrHomeDir();
        this.store = new Conf({
            cwd: paths.homeDir,
            configName: 'n8n-local-owner-credentials',
        });
    }
    get(url) {
        const instances = this.store.get('instances') ?? {};
        const normalizedUrl = normalizeUrl(url);
        const entry = instances[normalizedUrl];
        if (!entry) {
            return undefined;
        }
        return {
            url: normalizedUrl,
            ...entry,
        };
    }
    save(credentials) {
        const normalizedUrl = normalizeUrl(credentials.url);
        const instances = this.store.get('instances') ?? {};
        instances[normalizedUrl] = {
            email: credentials.email,
            password: credentials.password,
            firstName: credentials.firstName,
            lastName: credentials.lastName,
            createdAt: credentials.createdAt,
        };
        this.store.set('instances', instances);
        return {
            ...credentials,
            url: normalizedUrl,
        };
    }
}
function normalizeUrl(url) {
    try {
        return new URL(url).origin;
    }
    catch {
        return url.replace(/\/$/, '');
    }
}
//# sourceMappingURL=owner-credentials.js.map