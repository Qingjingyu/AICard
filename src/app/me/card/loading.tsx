export default function PrivateCardLoading() {
  return (
    <main className="private-card-page">
      <header className="card-page__masthead"><p className="card-page__brand">AI Card</p><p>VERIFYING</p></header>
      <div className="private-card-page__layout" aria-label="正在加载私密 Card">
        <div className="identity-card identity-card--loading"><div className="card-skeleton card-skeleton--short" /><div className="card-skeleton card-skeleton--name" /><div className="card-skeleton card-skeleton--long" /></div>
      </div>
    </main>
  );
}
