import { randomBytes, timingSafeEqual } from 'node:crypto';

import type {
  ProductFederationFlow,
} from '../src/server/federation/product-federation-service';
import type {
  ProductLoginResult,
  ProductMemberView,
} from '../src/server/postgres/product-federation-repository';

const CSRF_COOKIE = 'reference_product_csrf';
const FLOW_COOKIE = 'reference_product_flow';
const SESSION_COOKIE = 'reference_product_session';

type ReferenceProductDependencies = {
  productOrigin: string;
  clientId: string;
  redirectUri: string;
  begin(input: { clientId: string; redirectUri: string }): Promise<ProductFederationFlow>;
  authorizationUrl(flow: ProductFederationFlow): string;
  complete(input: {
    flow: Pick<ProductFederationFlow, 'flowToken'>;
    code: string;
    returnedState: string;
  }): Promise<ProductLoginResult>;
  resolveSession(sessionToken: string): Promise<ProductMemberView | null>;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!);
}

function readCookie(request: Request, name: string): string | undefined {
  for (const item of request.headers.get('cookie')?.split(';') ?? []) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return undefined;
}

function tokensMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookie(name: string, value: string, input: {
  httpOnly?: boolean;
  secure: boolean;
  maxAge: number;
}): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${input.maxAge}`,
    'SameSite=Lax',
    input.httpOnly ? 'HttpOnly' : '',
    input.secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function page(input: {
  state: 'empty' | 'error' | 'success';
  csrfToken: string;
  member?: ProductMemberView;
}): string {
  const content = input.state === 'success' && input.member
    ? `<p class="eyebrow">AI CARD / CONNECTED</p>
       <h1>${escapeHtml(input.member.displayName)}</h1>
       <p class="lede">这个产品已使用你的统一身份，不会重新创建账号。</p>
       <dl><div><dt>AI Card ID</dt><dd>${escapeHtml(input.member.cardId)}</dd></div>
       <div><dt>Handle</dt><dd>@${escapeHtml(input.member.handle)}</dd></div></dl>`
    : input.state === 'error'
      ? `<p class="eyebrow">CONNECTION / RETRY</p><h1>连接没有完成</h1>
         <p class="lede">身份服务没有留下本地替代账号。你可以安全地重新尝试。</p>
         <form method="post" action="/connect"><input type="hidden" name="csrf" value="${escapeHtml(input.csrfToken)}">
         <button type="submit">重新连接</button></form>`
      : `<p class="eyebrow">TEST PRODUCT / IDENTITY</p><h1>连接你的 AI Card</h1>
         <p class="lede">使用已有身份，或在 AI Card 创建一张永久 Card 后自动返回。</p>
         <form method="post" action="/connect"><input type="hidden" name="csrf" value="${escapeHtml(input.csrfToken)}">
         <button type="submit">使用 AI Card 继续</button></form>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Card Test Product</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif;background:#090d12;color:#eef3f7}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 45%,#162531 0,#0b1117 36%,#070a0e 78%);display:grid;place-items:center}
    main{width:min(620px,calc(100vw - 32px));padding:54px 48px;border:1px solid rgba(186,220,238,.16);background:rgba(14,21,28,.76);box-shadow:0 30px 100px rgba(0,0,0,.45);backdrop-filter:blur(22px)}
    .eyebrow{font-size:12px;color:#8ea9b8;letter-spacing:.14em}h1{font-size:clamp(34px,6vw,60px);font-weight:520;line-height:1.06;margin:18px 0}.lede{max-width:470px;color:#aebbc4;line-height:1.7}
    button{margin-top:28px;min-height:48px;padding:0 24px;border:1px solid rgba(207,232,244,.25);background:#dbe9ef;color:#0b1116;font:inherit;cursor:pointer}button:hover{background:#fff}button:disabled{opacity:.6;cursor:wait}
    dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:32px}dl div{padding:18px;border-top:1px solid rgba(207,232,244,.16)}dt{font-size:11px;color:#758a96;text-transform:uppercase}dd{margin:8px 0 0;font-size:17px}
    footer{position:fixed;bottom:24px;font-size:11px;color:#586976;letter-spacing:.12em}@media(max-width:560px){main{padding:38px 28px}dl{grid-template-columns:1fr}}
  </style></head><body><main data-state="${input.state}">${content}</main>
  <footer>REFERENCE PRODUCT / PUBLIC API ONLY</footer>
  <script>document.querySelector('form')?.addEventListener('submit',event=>{const button=event.currentTarget.querySelector('button');button.disabled=true;button.textContent='正在前往 AI Card…';document.querySelector('main').dataset.state='loading'})</script>
  </body></html>`;
}

function html(body: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'text/html; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(body, {
    status: 200,
    headers: responseHeaders,
  });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((value) => headers.append('set-cookie', value));
  return new Response(null, { status: 303, headers });
}

export function createReferenceProductHandler(dependencies: ReferenceProductDependencies) {
  const secure = new URL(dependencies.productOrigin).protocol === 'https:';

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/connect') {
      const form = await request.formData();
      if (
        request.headers.get('origin') !== dependencies.productOrigin ||
        !tokensMatch(readCookie(request, CSRF_COOKIE), String(form.get('csrf') ?? ''))
      ) return new Response('Forbidden', { status: 403 });

      try {
        const flow = await dependencies.begin({
          clientId: dependencies.clientId,
          redirectUri: dependencies.redirectUri,
        });
        return redirect(dependencies.authorizationUrl(flow), [
          cookie(FLOW_COOKIE, flow.flowToken, { httpOnly: true, secure, maxAge: 600 }),
        ]);
      } catch (error) {
        const cause = error instanceof Error && error.cause instanceof Error
          ? ` (${error.cause.name}: ${error.cause.message})`
          : '';
        const detail = error instanceof Error
          ? `${error.name}: ${error.message}${cause}`
          : 'Unknown connection error';
        process.stderr.write(`Reference product connect failed: ${detail}\n`);
        return redirect('/?error=unavailable');
      }
    }

    if (request.method === 'GET' && url.pathname === '/callback') {
      const flowToken = readCookie(request, FLOW_COOKIE);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!flowToken || !code || !state || url.searchParams.has('error')) {
        return redirect('/?error=authorization');
      }
      try {
        const result = await dependencies.complete({
          flow: { flowToken },
          code,
          returnedState: state,
        });
        return redirect('/?connected=1', [
          cookie(SESSION_COOKIE, result.sessionToken, { httpOnly: true, secure, maxAge: 600 }),
          cookie(FLOW_COOKIE, '', { httpOnly: true, secure, maxAge: 0 }),
        ]);
      } catch (error) {
        const detail = error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'Unknown callback error';
        process.stderr.write(`Reference product callback failed: ${detail}\n`);
        return redirect('/?error=callback');
      }
    }

    if (request.method !== 'GET' || url.pathname !== '/') return new Response('Not found', { status: 404 });
    const csrfToken = readCookie(request, CSRF_COOKIE) ?? randomBytes(32).toString('base64url');
    const sessionToken = readCookie(request, SESSION_COOKIE);
    let member: ProductMemberView | null = null;
    if (sessionToken) {
      try {
        member = await dependencies.resolveSession(sessionToken);
      } catch {
        member = null;
      }
    }
    const headers = new Headers();
    if (!readCookie(request, CSRF_COOKIE)) {
      headers.append('set-cookie', cookie(CSRF_COOKIE, csrfToken, { secure, maxAge: 3_600 }));
    }
    const state = member ? 'success' : url.searchParams.has('error') ? 'error' : 'empty';
    return html(page({ state, csrfToken, member: member ?? undefined }), headers);
  };
}
