'use client';

export default function PrivateCardError({ reset }: { reset(): void }) {
  return (
    <main className="card-page">
      <section className="card-page__message">
        <p className="eyebrow">PRIVATE CARD / ERROR</p>
        <h1>私密 Card 暂时无法打开</h1>
        <p>没有敏感数据被展示。请重试，或返回首页重新登录。</p>
        <button className="text-action" type="button" onClick={reset}>重新加载</button>
      </section>
    </main>
  );
}
