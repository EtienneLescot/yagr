/**
 * LangChain version of the httpRequest tool.
 *
 * Same security posture and response shape as the Vercel AI SDK version —
 * only the tool wrapper format changes.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const MAX_BODY_SIZE = 32_000;

function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_SIZE) {
    return body;
  }
  return `${body.slice(0, MAX_BODY_SIZE)}\n[... truncated, ${body.length - MAX_BODY_SIZE} chars omitted]`;
}

export const httpRequestTool = tool(
  async ({ method, url, headers, body, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: headers,
        body: body ?? undefined,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      return JSON.stringify({
        ok: false,
        url,
        method,
        error: error instanceof Error ? error.message : String(error),
      });
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

    let json: unknown;
    if (truncated === responseBody) {
      try {
        json = JSON.parse(responseBody);
      } catch {
        // Not JSON — leave json undefined
      }
    }

    return JSON.stringify({
      ok: response.ok,
      url,
      method,
      status: response.status,
      statusText: response.statusText,
      body: truncated,
      ...(json !== undefined ? { json } : {}),
    });
  },
  {
    name: 'httpRequest',
    description:
      'Make an HTTP request to a local or external URL. Use this for low-level inspection, health checks, credential validation, or probing endpoints. ' +
      'Do NOT use this for SSRF-sensitive contexts or to access private network addresses outside the local machine.',
    schema: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').describe('HTTP method.'),
      url: z.string().url().describe('Full URL to request.'),
      headers: z.record(z.string()).optional().describe('HTTP headers as key/value pairs.'),
      body: z.string().optional().describe('Request body as a string (e.g. JSON-serialized object). Set Content-Type header accordingly.'),
      timeoutMs: z.number().int().min(500).max(30_000).default(10_000).describe('Request timeout in milliseconds.'),
    }),
  },
);
