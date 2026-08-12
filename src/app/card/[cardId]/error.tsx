'use client';

import { useEffect } from 'react';

export default function PublicCardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Public AI Card route failure', { digest: error.digest });
  }, [error.digest]);

  return (
    <main className="card-page" data-state="error">
      <section className="card-page__message" role="alert">
        <p className="eyebrow">CARD / DEGRADED</p>
        <h1>暂时无法读取这张 Card</h1>
        <p>请求已经安全停止，私有信息没有被降级展示。</p>
        <button className="text-action" type="button" onClick={reset}>重新读取</button>
      </section>
    </main>
  );
}
