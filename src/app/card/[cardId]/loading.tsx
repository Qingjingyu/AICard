export default function PublicCardLoading() {
  return (
    <main className="card-page" data-state="loading">
      <header className="card-page__masthead">
        <p className="card-page__brand">AI Card</p>
        <p>Public identity</p>
      </header>
      <section className="card-page__stage" aria-live="polite">
        <div className="identity-card identity-card--loading" aria-label="正在读取 AI Card">
          <div className="card-skeleton card-skeleton--short" />
          <div className="card-skeleton card-skeleton--name" />
          <div className="card-skeleton card-skeleton--long" />
        </div>
      </section>
    </main>
  );
}
