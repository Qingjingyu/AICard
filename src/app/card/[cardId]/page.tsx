import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CardFront } from '@/components/card/card-front';
import { publicCardLookupSchema } from '@/domain/identity/schemas';
import { IdentityNotFoundError } from '@/server/identity-errors';
import { getIdentityService } from '@/server/identity';

export const dynamic = 'force-dynamic';

async function loadPublicCard(cardId: string) {
  try {
    return await getIdentityService().getPublicCard(cardId);
  } catch (error) {
    if (error instanceof IdentityNotFoundError) notFound();
    throw error;
  }
}

export default async function PublicCardPage({ params }: { params: Promise<{ cardId: string }> }) {
  const parsedCardId = publicCardLookupSchema.safeParse((await params).cardId);
  if (!parsedCardId.success) notFound();
  const card = await loadPublicCard(parsedCardId.data);

  return (
    <main className="card-page" data-state="success">
      <header className="card-page__masthead">
        <Link href="/" className="card-page__brand">AI Card</Link>
        <p>Public identity</p>
      </header>
      <section className="card-page__stage">
        <CardFront card={card} />
        <p className="card-page__caption">永久身份编号可公开核验；平台权限与私有资料不在此页面展示。</p>
      </section>
    </main>
  );
}
