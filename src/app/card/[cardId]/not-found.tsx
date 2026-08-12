import Link from 'next/link';

export default function PublicCardNotFound() {
  return (
    <main className="card-page" data-state="empty">
      <header className="card-page__masthead">
        <Link href="/" className="card-page__brand">AI Card</Link>
        <p>Public identity</p>
      </header>
      <section className="card-page__message">
        <p className="eyebrow">CARD / NOT FOUND</p>
        <h1>没有找到这张 AI Card</h1>
        <p>编号无效、身份尚未创建，或这张 Card 已不再公开。</p>
        <Link className="text-action" href="/">返回系统首页</Link>
      </section>
    </main>
  );
}
