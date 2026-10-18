/**
 * ShareCard.tsx — מסך "הכרטיס" באפליקציה.
 *
 * מציג תצוגה מקדימה חיה של הכרטיס (הקנבס האמיתי, מוקטן ב-CSS —
 * מה שרואים הוא בדיוק מה שישותף), ושלושה מסלולי שיתוף.
 *
 * דגש קריטי: הקנבס מרונדר ב-useEffect ברגע שהדאטה מגיע, כדי שכאשר
 * המשתמש ילחץ "שתף" ה-Blob כבר מוכן. שיתוף ב-iOS נחסם אם יש await
 * ארוך בין הלחיצה ל-navigator.share.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  renderShareCard, CARD_W, CARD_H, type ShareCardData,
} from '../lib/shareCard.ts';
import {
  canvasToBlob, shareCardImage, shareToWhatsApp, downloadBlob,
  buildShareText, copyToClipboard, type ShareResult,
} from '../lib/share.ts';
import { useI18n } from '../lib/i18n/index.tsx';

type Status = 'rendering' | 'ready' | 'sharing' | 'error';

export function ShareCard({ data }: { data: ShareCardData }) {
  const { t, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [status, setStatus] = useState<Status>('rendering');
  const [toast, setToast] = useState<string | null>(null);

  // רינדור מוקדם — ה-Blob מוכן לפני שהמשתמש בכלל חושב ללחוץ
  useEffect(() => {
    let cancelled = false;
    setStatus('rendering');
    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        await renderShareCard(data, { canvas });
        const blob = await canvasToBlob(canvas);
        if (cancelled) return;
        blobRef.current = blob;
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [data, locale]);

  const shareText = buildShareText({
    userName: data.userName,
    gameweekLabel: data.gameweekLabel,
    points: data.totalPoints,
    rank: data.rank,
    totalPlayers: data.totalPlayers,
  });

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setStatus('sharing');
    const result: ShareResult = await shareCardImage({
      blob, url: data.url, text: shareText, title: t('share.brand'),
      fileName: `dubid-${data.gameweekLabel.replace(/\s/g, '-')}.png`,
    });
    setStatus('ready');
    if (result.method === 'download') flash(t('share.flash.downloaded'));
    if (result.method === 'failed') flash(t('share.flash.failed'));
  }, [data.url, data.gameweekLabel, shareText, t]);

  const handleWhatsApp = () => {
    shareToWhatsApp(shareText, data.url, blobRef.current ?? undefined);
  };

  const handleDownload = () => {
    if (blobRef.current) {
      downloadBlob(blobRef.current, `dubid-${data.gameweekLabel.replace(/\s/g, '-')}.png`);
      flash(t('share.flash.saved'));
    }
  };

  const handleCopy = async () => {
    flash((await copyToClipboard(data.url)) ? t('share.flash.linkCopied') : t('share.flash.copyFailed'));
  };

  return (
    <div className="flex h-full flex-col bg-night">
      {/* התצוגה המקדימה: קנבס אמיתי בגודל מלא, מוקטן ב-CSS בלבד */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="relative overflow-hidden rounded-2xl bg-night-2 shadow-2xl
                          ring-1 ring-gold/15">
            <canvas
              ref={canvasRef}
              width={CARD_W}
              height={CARD_H}
              className="block h-auto w-full"
              aria-label={t('share.cardAria', { points: data.totalPoints, gw: data.gameweekLabel })}
            />
            {status === 'rendering' && (
              <div className="absolute inset-0 grid place-items-center bg-night/80">
                <span className="animate-pulse font-display text-sm text-chalk-dim">
                  {t('share.preparing')}
                </span>
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-xs text-chalk-dim">
            {t('share.sizeHint')}
          </p>
        </div>
      </div>

      {/* פעולות — צמודות לתחתית, מעל הניווט, עם safe-area */}
      <div className="border-t border-gold/15 bg-night/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]
                      pt-3 backdrop-blur">
        <button
          onClick={handleShare}
          disabled={status !== 'ready'}
          className="tap h-14 w-full rounded-full bg-gold font-poster text-xl text-night
                     transition-transform duration-200 ease-brand active:scale-[.98]
                     disabled:bg-night-3 disabled:text-chalk-dim"
        >
          {status === 'sharing' ? t('share.opening') : t('share.shareCard')}
        </button>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <SecondaryButton onClick={handleWhatsApp} disabled={status !== 'ready'}>
            {t('share.whatsapp')}
          </SecondaryButton>
          <SecondaryButton onClick={handleDownload} disabled={status !== 'ready'}>
            {t('acct.save')}
          </SecondaryButton>
          <SecondaryButton onClick={handleCopy}>{t('share.copyLink')}</SecondaryButton>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-28 z-toast mx-auto w-fit
                     rounded-full bg-chalk px-4 py-2 text-sm font-bold text-night shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function SecondaryButton({
  children, onClick, disabled,
}: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="tap h-12 rounded-full border border-chalk/15 bg-night-2 text-sm font-bold
                 text-chalk transition-colors duration-200 ease-brand
                 active:bg-night-3 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
