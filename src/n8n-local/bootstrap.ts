import crypto from 'node:crypto';
import { ManagedN8nOwnerCredentialService, type ManagedN8nOwnerCredentials } from './owner-credentials.js';
import { markManagedN8nBootstrapStage } from './state.js';

const OWNER_SETUP_PATH = '/rest/owner/setup';
const LOGIN_PATH = '/rest/login';
const API_KEYS_PATH = '/rest/api-keys';
const SURVEY_PATH = '/rest/me/survey';
const COMMUNITY_LICENSE_PATH = '/rest/license/enterprise/community-registered';
const DEFAULT_API_KEY_SCOPES = ['workflow:read'];
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_DELAY_MS = 1_500;

export interface SilentManagedN8nBootstrapResult {
  mode: 'silent' | 'assisted';
  apiKey?: string;
  ownerCredentials?: ManagedN8nOwnerCredentials;
  reason?: string;
}

export async function bootstrapManagedLocalN8n(options: {
  url: string;
  ownerCredentialService?: ManagedN8nOwnerCredentialService;
}): Promise<SilentManagedN8nBootstrapResult> {
  const credentialService = options.ownerCredentialService ?? new ManagedN8nOwnerCredentialService();
  const storedCredentials = credentialService.get(options.url);
  const ownerCredentials = storedCredentials ?? buildGeneratedOwnerCredentials(options.url);

  try {
    const sessionCookie = await retryBootstrapStep(
      storedCredentials ? 'owner login' : 'owner setup',
      async () => storedCredentials
        ? await loginOwner(options.url, storedCredentials)
        : await setupOwner(options.url, ownerCredentials),
    );
    if (!storedCredentials) {
      credentialService.save(ownerCredentials);
    }
    const apiKey = await retryBootstrapStep(
      'api key creation',
      async () => await createApiKey(options.url, sessionCookie),
    );
    await finalizeManagedLocalN8nReadiness({
      url: options.url,
      sessionCookie,
      ownerCredentials,
    });
    markManagedN8nBootstrapStage(options.url, 'api-key-pending');

    return {
      mode: 'silent',
      apiKey,
      ownerCredentials,
    };
  } catch (error) {
    return {
      mode: 'assisted',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function setupOwner(url: string, credentials: ManagedN8nOwnerCredentials): Promise<string> {
  const response = await fetch(buildUrl(url, OWNER_SETUP_PATH), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: credentials.email,
      firstName: credentials.firstName,
      lastName: credentials.lastName,
      password: credentials.password,
    }),
  });

  if (!response.ok) {
    throw new Error(`Owner setup failed with ${response.status} ${response.statusText}.`);
  }

  const cookieHeader = response.headers.get('set-cookie');
  const authCookie = extractCookie(cookieHeader, 'n8n-auth');
  if (!authCookie) {
    return await loginOwner(url, credentials);
  }

  return authCookie;
}

async function createApiKey(url: string, sessionCookie: string): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createApiKeyAttempt(url, sessionCookie, buildApiKeyLabel(attempt));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!lastError.message.includes('There is already an entry with this name')) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('API key creation failed.');
}

async function createApiKeyAttempt(url: string, sessionCookie: string, label: string): Promise<string> {
  const response = await fetch(buildUrl(url, API_KEYS_PATH), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie,
    },
    body: JSON.stringify({
      label,
      scopes: DEFAULT_API_KEY_SCOPES,
      expiresAt: null,
    }),
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(`API key creation failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}.`);
  }

  const payload = await response.json() as { data?: { rawApiKey?: string } };
  const apiKey = payload.data?.rawApiKey;
  if (!apiKey) {
    throw new Error('API key creation succeeded but no raw API key was returned.');
  }

  return apiKey;
}

async function loginOwner(url: string, credentials: ManagedN8nOwnerCredentials): Promise<string> {
  const response = await fetch(buildUrl(url, LOGIN_PATH), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      emailOrLdapLoginId: credentials.email,
      password: credentials.password,
    }),
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(`Owner login failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}.`);
  }

  const cookieHeader = response.headers.get('set-cookie');
  const authCookie = extractCookie(cookieHeader, 'n8n-auth');
  if (!authCookie) {
    throw new Error('Owner login did not return an authenticated n8n session cookie.');
  }

  return authCookie;
}

async function finalizeManagedLocalN8nReadiness(options: {
  url: string;
  sessionCookie: string;
  ownerCredentials: ManagedN8nOwnerCredentials;
}): Promise<void> {
  await retryBootstrapStep(
    'personalization survey submission',
    async () => await submitPersonalizationSurvey(options.url, options.sessionCookie, options.ownerCredentials.email),
  );
  await retryBootstrapStep(
    'community license registration',
    async () => await registerCommunityEdition(options.url, options.sessionCookie, options.ownerCredentials.email),
  ).catch(() => {
    // The "free forever" license prompt is skippable in the UI, so registration must not block local readiness.
  });
}

async function submitPersonalizationSurvey(url: string, sessionCookie: string, email: string): Promise<void> {
  const response = await fetch(buildUrl(url, SURVEY_PATH), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie,
    },
    body: JSON.stringify({
      version: 'v4',
      personalization_survey_submitted_at: new Date().toISOString(),
      personalization_survey_n8n_version: 'yagr-managed',
      companySize: 'personalUser',
      companyType: 'personal',
      role: 'engineering',
      reportedSource: 'other',
      reportedSourceOther: 'yagr-managed-local',
      usageModes: ['own'],
      companyIndustryExtended: ['technology'],
      email,
    }),
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(`Survey submission failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}.`);
  }
}

async function registerCommunityEdition(url: string, sessionCookie: string, email: string): Promise<void> {
  const response = await fetch(buildUrl(url, COMMUNITY_LICENSE_PATH), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie,
    },
    body: JSON.stringify({ email }),
  });

  if (response.ok) {
    return;
  }

  const body = await safeReadText(response);
  const lowerBody = body.toLowerCase();
  if (
    response.status === 409
    || lowerBody.includes('already registered')
    || lowerBody.includes('already exists')
    || lowerBody.includes('already activated')
  ) {
    return;
  }

  throw new Error(`Community registration failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}.`);
}

function buildGeneratedOwnerCredentials(url: string): ManagedN8nOwnerCredentials {
  const suffix = crypto.randomBytes(6).toString('hex');
  return {
    url,
    email: `yagr-local-${suffix}@local.yagr`,
    password: `Yagr${crypto.randomBytes(8).toString('hex').toUpperCase()}1`,
    firstName: 'Yagr',
    lastName: 'Local',
    createdAt: new Date().toISOString(),
  };
}

function buildApiKeyLabel(attempt: number): string {
  if (attempt === 0) {
    return 'Yagr Local Managed';
  }

  return `Yagr Local Managed ${attempt + 1}`;
}

function buildUrl(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function extractCookie(headerValue: string | null, cookieName: string): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const targetPrefix = `${cookieName}=`;
  const parts = headerValue.split(/,(?=[^;]+=[^;]+)/);
  for (const part of parts) {
    const firstSegment = part.split(';', 1)[0]?.trim();
    if (firstSegment?.startsWith(targetPrefix)) {
      return firstSegment;
    }
  }

  return undefined;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

async function retryBootstrapStep<T>(
  stepName: string,
  action: () => Promise<T>,
  timeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetryableBootstrapError(lastError)) {
        throw lastError;
      }
      await delay(retryDelayMs);
    }
  }

  throw new Error(`${stepName} timed out: ${lastError?.message ?? 'unknown error'}`);
}

function isRetryableBootstrapError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch')
    || message.includes('fetch failed')
    || message.includes('timed out')
    || message.includes('unauthorized')
    || message.includes('bad gateway')
    || message.includes('service unavailable')
    || message.includes('internal server error')
    || message.includes('owner setup failed with 404')
    || message.includes('owner setup failed with 502')
    || message.includes('owner setup failed with 503')
    || message.includes('owner setup did not return an authenticated n8n session cookie')
    || message.includes('owner login failed with 404')
    || message.includes('owner login failed with 429')
    || message.includes('owner login failed with 502')
    || message.includes('owner login failed with 503')
    || message.includes('owner login did not return an authenticated n8n session cookie')
    || message.includes('api key creation failed with 401')
    || message.includes('api key creation failed with 404')
    || message.includes('api key creation failed with 429')
    || message.includes('api key creation failed with 502')
    || message.includes('api key creation failed with 503')
    || message.includes('survey submission failed with 401')
    || message.includes('survey submission failed with 404')
    || message.includes('survey submission failed with 429')
    || message.includes('survey submission failed with 502')
    || message.includes('survey submission failed with 503')
    || message.includes('community registration failed with 401')
    || message.includes('community registration failed with 404')
    || message.includes('community registration failed with 429')
    || message.includes('community registration failed with 502')
    || message.includes('community registration failed with 503')
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
