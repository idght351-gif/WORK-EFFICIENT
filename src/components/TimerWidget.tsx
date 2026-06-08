import React from "react";

interface TimerWidgetProps {
  currentRound: number;
  isFeedbackMode: boolean;
  timerSeconds: number;
  isTimerRunning: boolean;
  onToggleTimer: () => void;
  onResetTimer: (seconds: number) => void;
  onSetFeedbackMode: (mode: boolean) => void;
  onAddMinutes: (mins: number) => void;
  isFacilitator?: boolean;
}

export default function TimerWidget({
  currentRound,
  isFeedbackMode,
  timerSeconds,
  isTimerRunning,
  onToggleTimer,
  onResetTimer,
  onSetFeedbackMode,
  onAddMinutes,
  isFacilitator = false,
}: TimerWidgetProps) {
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const isCritical = timerSeconds < 60;

  return (
    <div className="bg-neutral-900 text-white border-b-2 border-black py-8 px-6" id="timer-widget-root">
      <div className="max-w-7xl mx-auto flex flex-col md:grid md:grid-cols-3 gap-6 items-center">
        
        {/* Left Side: Session / Stage Info */}
        <div className="text-center md:text-left">
          <h2 className="text-3xl font-black tracking-tight text-white uppercase">
            {currentRound}회차
          </h2>
        </div>

        {/* CENTER: GIGANTIC BOLD TIMER (Highly prominent, top middle of screen) */}
        <div className="text-center space-y-1 py-2">
          <span className="font-mono text-[10px] text-neutral-400 tracking-widest block uppercase font-bold">
            ⏱️ REMAINING TIMER (남은 시간)
          </span>
          <div className="flex flex-col items-center justify-center">
            <div className={`font-mono text-7xl md:text-8xl font-black tracking-tighter tabular-nums leading-none ${isCritical ? "text-red-500 animate-pulse" : "text-white"}`}>
              {formatTime(timerSeconds)}
            </div>
            {isCritical && (
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.25 bg-red-600 text-white font-extrabold tracking-widest animate-bounce mt-1">
                CRITICAL WARNING
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Command Controls & Phase Sliders */}
        {isFacilitator ? (
          <div className="flex flex-col gap-3 w-full md:max-w-[280px] justify-self-end">
            <div className="flex gap-1.5 w-full">
              <button
                onClick={onToggleTimer}
                className={`flex-1 py-2 text-xs font-mono font-black border transition-all duration-150 cursor-pointer ${
                  isTimerRunning
                    ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                    : "bg-white text-black border-white hover:bg-neutral-200"
                }`}
                id="btn-timer-toggle"
              >
                {isTimerRunning ? "PAUSE (정지)" : "START (시작)"}
              </button>

              <button
                onClick={() => onResetTimer(isFeedbackMode ? 300 : 1800)}
                className="px-3.5 py-2 text-xs font-mono border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800 transition cursor-pointer"
                id="btn-timer-reset"
              >
                RESET
              </button>

              <button
                onClick={() => onAddMinutes(5)}
                className="px-3 py-2 text-xs font-mono border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800 transition cursor-pointer"
                id="btn-timer-add5"
              >
                +5M
              </button>
            </div>

            {/* Mode switch selectors */}
            <div className="flex gap-1 w-full border border-neutral-800 p-0.5 bg-neutral-950">
              <button
                onClick={() => {
                  onSetFeedbackMode(false);
                  onResetTimer(1800);
                }}
                className={`flex-1 text-[10px] font-mono py-1.5 border transition cursor-pointer uppercase ${
                  !isFeedbackMode
                    ? "bg-neutral-800 text-white border-neutral-700 font-bold"
                    : "bg-transparent text-neutral-500 border-transparent hover:text-neutral-300"
                }`}
              >
                DISCUSSION (30m)
              </button>
              <button
                onClick={() => {
                  onSetFeedbackMode(true);
                  onResetTimer(300);
                }}
                className={`flex-1 text-[10px] font-mono py-1.5 border transition cursor-pointer uppercase ${
                  isFeedbackMode
                    ? "bg-neutral-850 text-white border-neutral-700 font-bold"
                    : "bg-transparent text-neutral-500 border-transparent hover:text-neutral-300"
                }`}
              >
                FEEDBACK (5m)
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 w-full md:max-w-[280px] justify-self-end text-neutral-400 font-mono text-center md:text-right">
            <span className="text-[11px] font-black tracking-widest uppercase">
              🔒 TIMER CONTROL RESTRICTED
            </span>
            <span className="text-[10px] text-neutral-500 font-sans">
              타이머 조작은 관리자만 가능합니다.
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
