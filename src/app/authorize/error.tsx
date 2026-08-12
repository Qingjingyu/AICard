'use client';

export default function AuthorizeError({ reset }: { reset: () => void }) {
  return (
    <main className="authorization-page">
      <section className="status-stage" role="alert">
        <div className="state-signal state-signal--error" aria-hidden="true"><span /></div>
        <p className="eyebrow">REQUEST REJECTED</p>
        <h1>无法确认这个平台</h1>
        <p className="description">客户端、返回地址、权限或 PKCE 信息不符合预注册规则。</p>
        <button className="auth-gateway__primary" type="button" onClick={reset}>重新核对</button>
      </section>
    </main>
  );
}
