import Conf from 'conf';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';

export interface ManagedN8nOwnerCredentials {
  url: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

interface ManagedN8nOwnerCredentialStore {
  instances?: Record<string, Omit<ManagedN8nOwnerCredentials, 'url'>>;
}

export class ManagedN8nOwnerCredentialService {
  private readonly store: Conf<ManagedN8nOwnerCredentialStore>;

  constructor() {
    const paths = getYagrPaths();
    ensureYagrHomeDir();
    this.store = new Conf<ManagedN8nOwnerCredentialStore>({
      cwd: paths.homeDir,
      configName: 'n8n-local-owner-credentials',
    });
  }

  get(url: string): ManagedN8nOwnerCredentials | undefined {
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

  save(credentials: ManagedN8nOwnerCredentials): ManagedN8nOwnerCredentials {
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

function normalizeUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, '');
  }
}
