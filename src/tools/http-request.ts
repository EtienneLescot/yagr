import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { emitToolEvent } from './observer.js';

const MAX_BODY_SIZE = 32_000; // characters

function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_SIZE) {
    return body;
  }

  return `${body.slice(0, MAX_BODY_SIZE)}\n[... truncated, ${body.length - MAX_BODY_SIZE} chars omitted]`;
}

export function createHttpRequestTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Make an HTTP request to a local or external URL. Use this to call local service APIs (n8n REST API, relay health check, etc.), inspect live state, validate credentials, or probe endpoints. ' +
      'Do NOT use this for SSRF-sensitive contexts or to access private network addresses outside the local machine. ' +
      'For n8n REST API calls, set the X-N8N-API-KEY header with the stored API key.',
    parameters: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').describe('HTTP method.'),
      url: z.string().url().describe('Full URL to request.'),
      headers: z.record(z.string()).optional().describe('HTTP headers as key/value pairs.'),
      body: z.string().nullable().optional().describe('Request body as a string (e.g. JSON-serialized object). Set Content-Type header accordingly.'),
      timeoutMs: z.number().int().min(500).max(30_000).default(10_000).describe('Request timeout in milliseconds.'),
    }),
    execute: async ({ method, url, headers, body, timeoutMs }) => {
      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'httpRequest',
        message: `${method} ${url}`,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: headers ?? {},
          body: body ?? undefined,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          url,
          method,
          error: message,
        };
      } finally {
        clearTimeout(timer);
      }

      let responseBody: string;
      try {
        responseBody = await response.text();
      } catch {
        responseBody = '';
      }

      const truncated = truncateBody(responseBody);

      // Try to parse as JSON for convenience
      let json: unknown = undefined;
      if (truncated === responseBody) {
        try {
          json = JSON.parse(responseBody);
        } catch {
          // Not JSON — leave json undefined
        }
      }

      return {
        ok: response.ok,
        url,
        method,
        status: response.status,
        statusText: response.statusText,
        body: truncated,
        json,
        truncated: truncated !== responseBody,
      };
    },
  });
}
