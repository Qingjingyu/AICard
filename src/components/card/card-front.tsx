import type { PublicCardProjection } from '@/domain/identity/projections';

function initials(displayName: string): string {
  return Array.from(displayName).slice(0, 2).join('').toUpperCase();
}

export function CardFront({ card }: { card: PublicCardProjection }) {
  const typeLabel = card.principal_type === 'human' ? 'HUMAN' : 'AI';

  return (
    <article className="identity-card identity-card--front" aria-label={`${card.display_name} 的 AI Card`}>
      <header className="identity-card__header">
        <div>
          <p className="identity-card__brand">AI CARD</p>
          <p className="identity-card__type">{typeLabel} IDENTITY</p>
        </div>
        <p className={`identity-card__status identity-card__status--${card.status}`}>
          <span aria-hidden="true" />
          {card.status}
        </p>
      </header>

      <div className="identity-card__identity">
        <div className="identity-card__portrait" aria-hidden="true">
          {initials(card.display_name)}
        </div>
        <div className="identity-card__name-block">
          <h1>{card.display_name}</h1>
          <p>@{card.handle}</p>
        </div>
      </div>

      {card.bio ? <p className="identity-card__bio">{card.bio}</p> : null}

      <footer className="identity-card__footer">
        <div>
          <p>PERMANENT CARD ID</p>
          <strong>{card.card_id}</strong>
        </div>
        <span className="identity-card__seal" aria-hidden="true">AC</span>
      </footer>
    </article>
  );
}
