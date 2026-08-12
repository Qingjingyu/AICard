export default function Loading() {
  return (
    <main className="foundation foundation--route-loading" data-state="loading">
      <section className="status-stage" aria-live="polite">
        <div className="state-signal state-signal--loading" aria-hidden="true">
          <span />
        </div>
        <p className="eyebrow">SYSTEM / CHECKING</p>
        <h1>正在确认服务状态</h1>
        <p className="description">正在建立安全上下文。</p>
      </section>
    </main>
  );
}
