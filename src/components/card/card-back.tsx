import type { PrivateCardProjection } from '@/domain/identity/projections';

export function CardBack({ card }: { card: PrivateCardProjection }) {
  return (
    <article className="identity-card identity-card--back" aria-label={`${card.card.display_name} 的私有 Card 背面`}>
      <header className="identity-card__header">
        <div>
          <p className="identity-card__brand">AI CARD / PRIVATE</p>
          <p className="identity-card__type">MANAGEMENT VIEW</p>
        </div>
        <p className={`identity-card__status identity-card__status--${card.lifecycle.status}`}>
          <span aria-hidden="true" />
          {card.lifecycle.status}
        </p>
      </header>

      <div className="identity-card__back-grid">
        <section aria-labelledby="controllers-heading">
          <h2 id="controllers-heading">控制者</h2>
          {card.controllers.length > 0 ? (
            <ul>
              {card.controllers.map((controller) => (
                <li key={controller.card_id}>
                  <strong>{controller.display_name}</strong>
                  <span>@{controller.handle}</span>
                </li>
              ))}
            </ul>
          ) : <p className="identity-card__empty">没有控制者记录</p>}
        </section>

        <section aria-labelledby="history-heading">
          <h2 id="history-heading">Handle 历史</h2>
          {card.handle_history.length > 0 ? (
            <ul>
              {card.handle_history.map((entry) => (
                <li key={entry.handle}>
                  <strong>@{entry.handle}</strong>
                  <span>已保留</span>
                </li>
              ))}
            </ul>
          ) : <p className="identity-card__empty">尚未修改过 Handle</p>}
        </section>
      </div>

      <footer className="identity-card__footer">
        <div>
          <p>CREATED</p>
          <strong>{new Date(card.lifecycle.created_at).toLocaleDateString('zh-CN')}</strong>
        </div>
        <p className="identity-card__private-note">凭据和秘密不会显示在 Card 上</p>
      </footer>
    </article>
  );
}
