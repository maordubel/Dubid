import { STATUS_LABEL, type GameStatus } from '../lib/gameStatus.ts';

const DOT_CLASS: Record<GameStatus, string> = {
  not_started: 'bg-chalk-dim',
  draft: 'bg-armband',
  ready: 'bg-gold',
  locked: 'bg-tekhelet',
  finished: 'bg-gold',
};

export function GameStatusBadge({ status }: { status: GameStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-night-3 px-2.5 py-1 text-[11px] font-bold text-chalk-2">
      <span className={`size-1.5 rounded-full ${DOT_CLASS[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
