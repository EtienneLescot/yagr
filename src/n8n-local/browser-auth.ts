import type { ManagedN8nOwnerCredentials } from './owner-credentials.js';

export function buildManagedN8nWorkflowOpenPage(input: {
  targetUrl: string;
  loginUrl: string;
  credentials: ManagedN8nOwnerCredentials;
}): string {
  const pageTitle = escapeHtml(`Open ${input.targetUrl}`);
  const escapedTargetUrl = escapeHtml(input.targetUrl);
  const escapedLoginUrl = escapeHtml(input.loginUrl);
  const escapedEmail = escapeHtml(input.credentials.email);
  const escapedPassword = escapeHtml(input.credentials.password);

  // Use meta-refresh for redirect: works even when the page shows JSON from the login response.
  // The form submits in the main window (setting cookies), then meta-refresh redirects to workflow.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="2;url=${escapedTargetUrl}" />
    <title>${pageTitle}</title>
    <style>
      :root { color-scheme: dark; --bg: #101418; --panel: #171d23; --text: #eef3f7; --muted: #9aa7b3; --accent: #ff6d5a; --accent-strong: #ff8d6b; --border: rgba(255,255,255,0.08); }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top right, rgba(255,109,90,0.22), transparent 34%), radial-gradient(circle at bottom left, rgba(95,160,255,0.16), transparent 30%), var(--bg); color: var(--text); font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
      .panel { width: min(680px, calc(100vw - 32px)); background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)), var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 14px; color: var(--muted); }
      .status { margin: 18px 0; padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
      a, button { appearance: none; border: 0; border-radius: 999px; padding: 10px 16px; font: inherit; cursor: pointer; text-decoration: none; }
      .primary { background: linear-gradient(135deg, var(--accent), var(--accent-strong)); color: #111; font-weight: 700; }
      .secondary { background: rgba(255,255,255,0.06); color: var(--text); }
      .secret { margin-top: 16px; padding: 14px; border-radius: 12px; border: 1px solid var(--border); background: rgba(0,0,0,0.18); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>Opening n8n workflow</h1>
      <p>Yagr is signing you into n8n, then opening the workflow.</p>
      <div class="status" id="status">Signing in…</div>
      <div class="actions">
        <a class="primary" href="${escapedTargetUrl}" id="open-link">Open workflow now</a>
        <button class="secondary" type="button" id="show-creds">Show credentials</button>
      </div>
      <section class="secret hidden" id="credentials">
        <p>Email<br /><code>${escapedEmail}</code></p>
        <p>Password<br /><code>${escapedPassword}</code></p>
      </section>
      <!-- The form targets a hidden iframe: the main page (and its meta-refresh) stays
           alive while the iframe absorbs the JSON login response. The Set-Cookie header
           from n8n is stored for the tunnel domain by the browser. When the meta-refresh
           fires (top-level GET navigation), the SameSite=Lax cookie is sent → authenticated. -->
      <iframe name="login-frame" style="display:none" aria-hidden="true"></iframe>
      <form id="login-form" method="post" action="${escapedLoginUrl}" target="login-frame" style="display:none">
        <input type="hidden" name="emailOrLdapLoginId" value="${escapedEmail}" />
        <input type="hidden" name="password" value="${escapedPassword}" />
      </form>
    </main>
    <script>
      (function() {
        var form = document.getElementById('login-form');
        var status = document.getElementById('status');
        var creds = document.getElementById('credentials');
        var btn = document.getElementById('show-creds');
        btn && btn.addEventListener('click', function() { creds && creds.classList.remove('hidden'); });
        try { form.submit(); }
        catch(e) { status.textContent = e.message || 'Sign-in failed.'; creds && creds.classList.remove('hidden'); }
      })();
    </script>
  </body>
</html>`;
}

export function buildManagedN8nWorkflowOpenDataUrl(input: {
  targetUrl: string;
  loginUrl: string;
  credentials: ManagedN8nOwnerCredentials;
}): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildManagedN8nWorkflowOpenPage(input))}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
