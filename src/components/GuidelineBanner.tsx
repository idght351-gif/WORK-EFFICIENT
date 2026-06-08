import React from "react";

interface GuidelineBannerProps {
  currentRound: number;
  isFeedbackMode: boolean;
  onAdvanceRound: () => void;
  onDecreaseRound: () => void;
}

export default function GuidelineBanner({
  currentRound,
  isFeedbackMode,
  onAdvanceRound,
  onDecreaseRound,
}: GuidelineBannerProps) {
  return (
    <div className="bg-white border-b border-black p-4" id="guideline-banner-root">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-none bg-black"></span>
          <span className="font-mono text-xs uppercase tracking-widest text-neutral-800 font-bold">
            STAGE MANAGEMENT
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={onDecreaseRound}
              disabled={currentRound === 1}
              className="px-3 py-1.5 text-xs font-mono font-bold border border-black hover:bg-neutral-100 disabled:opacity-25 disabled:hover:bg-transparent transition cursor-pointer text-black"
              title="이전 회차로"
            >
              PREV ROUND
            </button>
            <button
              onClick={onAdvanceRound}
              disabled={currentRound === 4}
              className="px-3 py-1.5 text-xs font-mono font-bold bg-black text-white hover:bg-neutral-800 disabled:opacity-25 disabled:hover:bg-black transition cursor-pointer"
              title="다음 회차로"
            >
              NEXT ROUND
            </button>
          </div>
          <p className="text-[10px] text-neutral-400 font-mono italic hidden sm:block">
            * 1회차부터 4회차까지 점진적 안건 정교화
          </p>
        </div>
      </div>
    </div>
  );
}
