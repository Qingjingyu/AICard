'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('AI Card route failure', { digest: error.digest });
  }, [error.digest]);

  return (
    <main className="foundation" data-state="error">
      <section className="status-stage" role="alert">
        <div className="state-signal state-signal--error" aria-hidden="true">
          <span />
        </div>
        <p className="eyebrow">SYSTEM / DEGRADED</p>
        <h1>身份服务暂不可用</h1>
        <p className="description">请求已安全停止。你可以重新检查当前状态。</p>
        <button className="text-action" type="button" onClick={reset}>
          重新检查
        </button>
      </section>
    </main>
  );
}
