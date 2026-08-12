export default function AuthorizeLoading() {
  return (
    <main className="authorization-page">
      <section className="status-stage" aria-busy="true">
        <div className="state-signal state-signal--loading" aria-hidden="true"><span /></div>
        <p className="eyebrow">PLATFORM AUTHORIZATION</p>
        <h1>正在核对授权请求</h1>
        <p className="description">正在验证平台、返回地址和所需权限。</p>
      </section>
    </main>
  );
}
