import React, { useState, useEffect } from "react";
import { Lock, Check, ShieldAlert, Key } from "lucide-react";
import { HackathonState, TeamData, RoundData } from "./types";
import {
  createInitialState,
  saveStateToStorage,
  loadStateFromStorage,
  SESSION_ROUNDS_INFO,
} from "./utils/workshopData";
import TimerWidget from "./components/TimerWidget";
import GuidelineBanner from "./components/GuidelineBanner";
import TeamWorkspace from "./components/TeamWorkspace";
import FacilitatorDashboard from "./components/FacilitatorDashboard";

export default function App() {
  const [state, setState] = useState<HackathonState>(() => {
    const saved = loadStateFromStorage();
    if (saved) return saved;
    return createInitialState(false); // default load clean empty slate
  });

  const [isProjectorMode, setIsProjectorMode] = useState<boolean>(false);
  const [isBroadcasting, setIsBroadcasting] = useState<boolean>(true);
  const [broadcastNotification, setBroadcastNotification] = useState<string | null>(null);
  
  const [myTeamId, setMyTeamId] = useState<string | null>(() => {
    return localStorage.getItem("my_team_id");
  });

  const [showSetupModal, setShowSetupModal] = useState<boolean>(() => {
    return !localStorage.getItem("my_team_id");
  });

  const [showAdminInput, setShowAdminInput] = useState<boolean>(false);
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [adminError, setAdminError] = useState<string | null>(null);

  const [userRole, setUserRole] = useState<"facilitator" | "participant">(() => {
    const saved = localStorage.getItem("my_team_id");
    return saved === "facilitator" ? "facilitator" : "participant";
  });

  const handleSelectRoleAndTeam = (teamId: string) => {
    setMyTeamId(teamId);
    localStorage.setItem("my_team_id", teamId);
    
    const role = teamId === "facilitator" ? "facilitator" : "participant";
    setUserRole(role);
    
    setShowSetupModal(false);

    // If they chose a specific team, let's automatically select that team's tab
    // to give them a seamless start!
    if (teamId !== "facilitator") {
      setState((prev) => ({
        ...prev,
        selectedTeamTab: teamId,
      }));
    }
  };

  // Sync state polling for "participant" follower nodes
  useEffect(() => {
    if (userRole !== "participant") return;

    const interval = setInterval(() => {
      fetch("/api/sync-state")
        .then((res) => {
          if (!res.ok) throw new Error("Sync server unresponsive");
          return res.json();
        })
        .then((data) => {
          if (!data) return;
          
          if (data.isBroadcasting !== undefined) {
            setIsBroadcasting(data.isBroadcasting);
          }

          setState((prev) => {
            let changed = false;
            const nextState = { ...prev };

            if (data.currentRound !== undefined && prev.currentRound !== data.currentRound) {
              nextState.currentRound = data.currentRound;
              changed = true;
            }
            if (data.isFeedbackMode !== undefined && prev.isFeedbackMode !== data.isFeedbackMode) {
              nextState.isFeedbackMode = data.isFeedbackMode;
              changed = true;
            }
            if (data.isTimerRunning !== undefined && prev.isTimerRunning !== data.isTimerRunning) {
              nextState.isTimerRunning = data.isTimerRunning;
              changed = true;
            }
            if (data.timerSeconds !== undefined && Math.abs(prev.timerSeconds - data.timerSeconds) > 3) {
              nextState.timerSeconds = data.timerSeconds;
              changed = true;
            }

            // Sync broadcast views from facilitator
            if (data.isBroadcasting) {
              if (data.activeTeamId !== undefined && prev.selectedTeamTab !== data.activeTeamId) {
                nextState.selectedTeamTab = data.activeTeamId;
                changed = true;
              }
              if (data.isProjectorLive !== undefined && isProjectorMode !== data.isProjectorLive) {
                setIsProjectorMode(data.isProjectorLive);
              }
            } else {
              // If broadcasting was disabled, make sure we turn off live projector view if it was forced
              if (isProjectorMode && data.isProjectorLive === false) {
                setIsProjectorMode(false);
              }
            }

            return changed ? nextState : prev;
          });
        })
        .catch((err) => console.warn("Real-time sync poll status:", err.message));
    }, 2000);

    return () => clearInterval(interval);
  }, [userRole, isProjectorMode]);

  const broadcastStateChange = (updated: any) => {
    if (userRole !== "facilitator") return;
    fetch("/api/sync-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    }).catch((err) => console.error("Real-time sync failed:", err));
  };

  const handleAdminClickTeamCard = (teamId: string) => {
    broadcastStateChange({ activeTeamId: teamId });
  };

  // Sync to LocalStorage
  useEffect(() => {
    saveStateToStorage(state);
  }, [state]);

  // Timer logic
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (state.isTimerRunning) {
      interval = setInterval(() => {
        setState((prev) => {
          if (prev.timerSeconds <= 1) {
            // Timer expired! Toggle states
            clearInterval(interval!);
            
            let nextFeedbackMode = !prev.isFeedbackMode;
            let nextRoundNum = prev.currentRound;
            let nextSeconds = nextFeedbackMode ? 300 : 1800; // 5 mins feedback or 30 mins discussion

            // If feedback session finished, advance to the next round
            if (!nextFeedbackMode) {
              nextRoundNum = prev.currentRound + 1;
              if (nextRoundNum > 4) {
                // End of Hackathon!
                return {
                  ...prev,
                  isTimerRunning: false,
                  timerSeconds: 0,
                  isFeedbackMode: false,
                };
              }
            }

            // Prepare announcement banner script
            const roundText = nextFeedbackMode
              ? `현재 ${prev.currentRound}회차 논의 세션이 종료되었습니다. 5분간 타 조의 안건들에 대해 [실행 가능성], [비용 효율], [조직 정합성] 세 항목의 비판 피드백을 전달해 주십시오.`
              : `다음 세션(${nextRoundNum}회차)을 시작합니다. 이번 회차에서는 지난 피드백을 반영하여 안건을 구체화하세요. 논의 시간은 30분입니다.`;
            
            setTimeout(() => {
              alert(`🚨 공지: ${roundText}`);
            }, 100);

            return {
              ...prev,
              currentRound: nextRoundNum,
              isFeedbackMode: nextFeedbackMode,
              timerSeconds: nextSeconds,
              isTimerRunning: false,
            };
          } else {
            return {
              ...prev,
              timerSeconds: prev.timerSeconds - 1,
            };
          }
        });
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [state.isTimerRunning]);

  // Handle manual tab switches
  const handleSetTeamTab = (tabId: string) => {
    if (myTeamId && myTeamId !== "facilitator" && tabId !== "all" && tabId !== myTeamId) {
      return; // block unauthorized access
    }
    setState((prev) => {
      if (isBroadcasting) {
        broadcastStateChange({ activeTeamId: tabId });
      }
      return {
        ...prev,
        selectedTeamTab: tabId,
      };
    });
  };

  // Toggle Timer Play/Pause
  const handleToggleTimer = () => {
    setState((prev) => {
      const nextRunning = !prev.isTimerRunning;
      broadcastStateChange({ isTimerRunning: nextRunning, timerSeconds: prev.timerSeconds });
      return {
        ...prev,
        isTimerRunning: nextRunning,
      };
    });
  };

  // Reset Timer to custom duration
  const handleResetTimer = (seconds: number) => {
    setState((prev) => {
      broadcastStateChange({ timerSeconds: seconds, isTimerRunning: false });
      return {
        ...prev,
        timerSeconds: seconds,
        isTimerRunning: false,
      };
    });
  };

  // Set Feedback mode manually
  const handleSetFeedbackMode = (mode: boolean) => {
    setState((prev) => {
      const nextSecs = mode ? 300 : 1800;
      broadcastStateChange({ isFeedbackMode: mode, timerSeconds: nextSecs, isTimerRunning: false });
      return {
        ...prev,
        isFeedbackMode: mode,
        timerSeconds: nextSecs,
        isTimerRunning: false,
      };
    });
  };

  // Add extra custom minutes
  const handleAddMinutes = (mins: number) => {
    setState((prev) => {
      const nextSecs = prev.timerSeconds + mins * 60;
      broadcastStateChange({ timerSeconds: nextSecs });
      return {
        ...prev,
        timerSeconds: nextSecs,
      };
    });
  };

  // Manual Stage Increment
  const handleAdvanceRound = () => {
    setState((prev) => {
      const nextRNum = Math.min(prev.currentRound + 1, 4);
      if (nextRNum !== prev.currentRound) {
        broadcastStateChange({ currentRound: nextRNum, isFeedbackMode: false, timerSeconds: 1800, isTimerRunning: false });
        return {
          ...prev,
          currentRound: nextRNum,
          isFeedbackMode: false,
          timerSeconds: 1800,
          isTimerRunning: false,
        };
      }
      return prev;
    });
  };

  // Manual Stage Decrement
  const handleDecreaseRound = () => {
    setState((prev) => {
      const nextRNum = Math.max(prev.currentRound - 1, 1);
      if (nextRNum !== prev.currentRound) {
        broadcastStateChange({ currentRound: nextRNum, isFeedbackMode: false, timerSeconds: 1800, isTimerRunning: false });
        return {
          ...prev,
          currentRound: nextRNum,
          isFeedbackMode: false,
          timerSeconds: 1800,
          isTimerRunning: false,
        };
      }
      return prev;
    });
  };

  // State Update callback for individual team workspace fields
  const handleUpdateRoundData = (roundNum: number, updatedFields: Partial<RoundData>) => {
    const activeTab = state.selectedTeamTab;
    if (activeTab === "all") return;

    setState((prev) => {
      const teamToUpdate = prev.teams[activeTab];
      if (!teamToUpdate) return prev;

      const currentRoundData = teamToUpdate.rounds[roundNum] || {
        roundNumber: roundNum,
        agendaTitle: "",
        agendaSummary: "",
        feasibilityFeedback: "",
        efficiencyFeedback: "",
        cultureFeedback: "",
        improvementDirection: "",
        nextQuestion: "",
        completionScore: 20,
        appliedChecklist: [],
      };

      const updatedRoundData = {
        ...currentRoundData,
        ...updatedFields,
      };

      const updatedRounds = {
        ...teamToUpdate.rounds,
        [roundNum]: updatedRoundData,
      };

      const updatedTeam = {
        ...teamToUpdate,
        rounds: updatedRounds,
      };

      const scoreAvg = (Object.values(updatedRounds) as RoundData[]).reduce((curr: number, next: RoundData) => curr + (next.completionScore || 0), 0) / 4;
      updatedTeam.isCompleted = scoreAvg >= 85;

      return {
        ...prev,
        teams: {
          ...prev.teams,
          [activeTab]: updatedTeam,
        },
      };
    });
  };

  // Direct edit from Facilitator Dashboard Table
  const handleUpdateRoundDataForTeam = (teamId: string, roundNum: number, updatedFields: any) => {
    setState((prev) => {
      const team = prev.teams[teamId];
      if (!team) return prev;
      const roundContent = team.rounds[roundNum];
      const updatedRoundContent = { ...roundContent, ...updatedFields };
      return {
        ...prev,
        teams: {
          ...prev.teams,
          [teamId]: {
            ...team,
            rounds: {
              ...team.rounds,
              [roundNum]: updatedRoundContent,
            },
          },
        },
      };
    });
  };

  // State Reset options
  const handleResetWorkshops = (usePresets: boolean) => {
    if (window.confirm(usePresets ? "안건 예시 데이터로 워크숍을 다시 초기화하시겠습니까? (현재 기입 데이터 소멸)" : "모든 내용을 완전히 비우고 무에서 새로 시작하시겠습니까?")) {
      const freshState = createInitialState(usePresets);
      setState(freshState);
    }
  };

  const selectedTeamData = state.teams[state.selectedTeamTab];
  const roundDetails = SESSION_ROUNDS_INFO[state.currentRound as 1 | 2 | 3 | 4];

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F5] font-sans antialiased text-black">
      {/* Workshop Navigation Header */}
      <header className="bg-white border-b-2 border-black sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          
          {/* Main Title Section */}
          <div>
            <h1 className="text-xl md:text-2xl font-black text-black tracking-tight">
              본부 간 업무효율화 간담회
            </h1>
          </div>

          {/* Quick Tools & Live Synchronization Role Switcher */}
          <div className="flex flex-wrap gap-2 items-center justify-start xl:justify-end">
            
            {/* Interactive Role Configuration Center */}
            <div className="flex items-center gap-2 border border-black p-1 bg-neutral-100">
              <span className="font-mono text-[10px] font-black px-1 text-neutral-500">배정 소속:</span>
              <span className="font-sans text-xs font-black bg-white border border-neutral-300 px-2 py-1 select-none">
                {myTeamId === "facilitator" ? (
                  <span className="text-black font-extrabold text-sm font-mono">💻 M</span>
                ) : myTeamId ? (
                  <span className="text-emerald-700 font-bold">👥 {myTeamId} 참가자</span>
                ) : (
                  <span className="text-red-500">지정 안 됨</span>
                )}
              </span>
              <button
                onClick={() => setShowSetupModal(true)}
                className="px-2 py-1 bg-black text-white hover:bg-neutral-800 transition font-mono text-[10px] uppercase font-bold cursor-pointer"
              >
                소속 배정 변경 🔁
              </button>
            </div>

            {myTeamId === "facilitator" && (
              <>
                <button
                  onClick={() => {
                    const nextBroadcasting = !isBroadcasting;
                    setIsBroadcasting(nextBroadcasting);
                    broadcastStateChange({
                      isBroadcasting: nextBroadcasting,
                      activeTeamId: nextBroadcasting ? state.selectedTeamTab : "all",
                      isProjectorLive: nextBroadcasting ? isProjectorMode : false,
                    });
                  }}
                  className={`px-4 py-2 border-2 font-black text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 ${
                    isBroadcasting
                      ? "bg-red-650 hover:bg-red-700 text-white border-red-650 animate-pulse"
                      : "bg-white text-black border-black hover:bg-neutral-100"
                  }`}
                  title="화면 생중계가 동작하여 본부장 탭 제어 및 대화면 상태가 전 참가자들에게 강제 전송됩니다."
                >
                  {isBroadcasting ? "📡 실시간 화면 중계 ON" : "📡 화면 중계 OFF"}
                </button>

                <button
                  onClick={() => {
                    setIsProjectorMode(true);
                    if (isBroadcasting) {
                      broadcastStateChange({ isProjectorLive: true });
                    }
                  }}
                  className="px-4 py-2 border-2 border-black bg-black text-white hover:bg-neutral-800 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  PROJECTOR (대형화면)
                </button>
                
                <button
                  onClick={() => handleResetWorkshops(false)}
                  className="px-3 py-2 border border-red-300 hover:border-red-500 hover:bg-red-50 font-mono text-[10px] text-red-650 transition cursor-pointer font-bold"
                >
                  ⚠️ 전체 데이터 비우기 (RESET)
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Synchronized Broadcast Notification Strip */}
      {broadcastNotification && (
        <div className="bg-neutral-900 border-b border-black text-white text-xs font-mono py-2.5 px-4 text-center tracking-wide animate-pulse">
          📡 [SYSTEM SYSTEM STATUS BROADCAST] {broadcastNotification}
        </div>
      )}

      {isBroadcasting && userRole === "participant" ? (
        <div className="bg-red-700 text-white text-xs py-2 px-4 border-b border-black flex items-center justify-center gap-1.5 font-bold tracking-wide animate-pulse">
          <span>📡 [실시간 중계 중] 퍼실리테이터의 화면(조 전환, 대화면)과 강제 동기화 상태입니다.</span>
        </div>
      ) : null}

      {/* Embedded Timer Control Center */}
      <TimerWidget
        currentRound={state.currentRound}
        isFeedbackMode={state.isFeedbackMode}
        timerSeconds={state.timerSeconds}
        isTimerRunning={state.isTimerRunning}
        onToggleTimer={handleToggleTimer}
        onResetTimer={handleResetTimer}
        onSetFeedbackMode={handleSetFeedbackMode}
        onAddMinutes={handleAddMinutes}
        isFacilitator={myTeamId === "facilitator"}
      />

      {/* Segment Guide Instructions */}
      <GuidelineBanner
        currentRound={state.currentRound}
        isFeedbackMode={state.isFeedbackMode}
        onAdvanceRound={handleAdvanceRound}
        onDecreaseRound={handleDecreaseRound}
      />

      {/* Main Workspace Frame */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* Dynamic Nav Tabs (Ctrl Board vs Team Workspaces) */}
        <div className="flex flex-wrap border border-black p-1 bg-white mb-6">
          <button
            onClick={() => handleSetTeamTab("all")}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border transition cursor-pointer flex-1 md:flex-none ${
              state.selectedTeamTab === "all"
                ? "bg-black text-white border-black"
                : "bg-transparent text-neutral-600 border-transparent hover:text-black hover:bg-neutral-50"
            }`}
          >
            📊 FACILITATOR CENTER SUMMARY BOARD (종합 현황 표)
          </button>
          
          {Object.keys(state.teams).map((teamId) => {
            const isTabSelected = state.selectedTeamTab === teamId;
            const tData = state.teams[teamId];
            const agendaTitle = tData.rounds[state.currentRound]?.agendaTitle;
            
            // Access permission: Only facilitator or the specific team members can enter
            const isAuthorized = myTeamId === "facilitator" || myTeamId === teamId;
            
            if (!isAuthorized) {
              return (
                <div
                  key={teamId}
                  className="px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider border border-transparent text-neutral-300 bg-neutral-50 flex items-center justify-center gap-1.5 select-none cursor-not-allowed flex-1"
                  title="소속 조만 접근 가능합니다."
                >
                  <Lock className="w-3.5 h-3.5 text-neutral-400" />
                  {teamId}
                </div>
              );
            }
            
            return (
              <button
                key={teamId}
                onClick={() => handleSetTeamTab(teamId)}
                className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider border transition cursor-pointer flex-1 ${
                  isTabSelected
                    ? "bg-black text-white border-black"
                    : "bg-transparent text-neutral-500 border-transparent hover:bg-neutral-100 hover:text-black"
                }`}
              >
                {teamId} {agendaTitle ? `(${agendaTitle.substring(0, 4)}..)` : ""}
              </button>
            );
          })}
        </div>

        {/* Workspace router view */}
        {state.selectedTeamTab === "all" ? (
          <FacilitatorDashboard
            state={state}
            onSetTeamTab={handleSetTeamTab}
            onUpdateRoundDataForTeam={handleUpdateRoundDataForTeam}
            onAdminClickTeamCard={handleAdminClickTeamCard}
            myTeamId={myTeamId}
          />
        ) : (
          selectedTeamData && (
            <TeamWorkspace
              team={selectedTeamData}
              currentRound={state.currentRound}
              onUpdateRoundData={handleUpdateRoundData}
              isReadOnly={userRole === "participant" && myTeamId !== state.selectedTeamTab}
              myTeamId={myTeamId || "선택안됨"}
              allTeams={state.teams}
              onUpdateRoundDataForTeam={handleUpdateRoundDataForTeam}
            />
          )
        )}
      </main>

      {/* Footer information section */}
      <footer className="bg-white border-t border-black py-8 px-6 text-center text-xs text-neutral-500 space-y-2 mt-auto">
        <p className="font-mono tracking-widest uppercase">
          본부업무효율화 해커톤 &middot; CRITICAL THINKING SYSTEM DESIGNED BY CENTRAL ARCHITECTURE
        </p>
        <p className="font-sans">
          "실행 가능성, 비용/시간 효율성, 조직문화 정합성에 어긋나는 모든 비대칭 관료주의를 박멸하십시오."
        </p>
      </footer>

      {/* GORGEOUS MONOCHROME FULL-SCREEN PROJECTOR TRANSMISSION OVERLAY */}
      {isProjectorMode && (
        <div className="fixed inset-0 bg-neutral-900 text-white z-50 flex flex-col p-8 md:p-12 overflow-y-auto font-sans" id="projector-overlay-root">
          
          {/* Projector Header Row */}
          <div className="flex justify-between items-start border-b border-neutral-700 pb-6">
            <div>
              <h1 className="text-3xl font-black tracking-tight">
                본부 간 업무효율화 간담회
              </h1>
              <p className="text-neutral-400 text-sm mt-1">
                {state.currentRound}회차 세션 진행중 : {roundDetails?.title}
              </p>
            </div>

            {/* EXIT Button */}
            <button
              onClick={() => {
                setIsProjectorMode(false);
                if (myTeamId === "facilitator" && isBroadcasting) {
                  broadcastStateChange({ isProjectorLive: false });
                }
              }}
              className="px-5 py-2.5 bg-white text-black border border-white hover:bg-neutral-200 transition font-mono tracking-widest text-xs font-black cursor-pointer uppercase"
            >
              CLOSE LIVE MONITOR [ ESC ]
            </button>
          </div>

          {/* Projector Body Columns */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
            
            {/* BIG CLOCK PANEL */}
            <div className="bg-neutral-850 p-8 border border-neutral-700 flex flex-col justify-between space-y-6">
              <div>
                <span className="font-mono text-xs text-neutral-400 tracking-wider">
                  SESSION PROGRESS INDICATOR
                </span>
                <h2 className="text-2xl font-bold mt-2">
                  {state.isFeedbackMode ? "타 조 비판 피드백 세션" : "안건 혁신 및 R&R 심층 조율"}
                </h2>
                <p className="text-xs text-neutral-400 mt-2 leading-relaxed whitespace-pre-wrap bg-neutral-900 p-3 border border-neutral-800">
                  {state.isFeedbackMode ? 
                    "모든 조원들은 실행 가능성, 비용/시간 효율성, 조직문화 정합성에 준하는 냉정한 피드백을 전달해 주십시오." :
                    roundDetails?.guide
                  }
                </p>
              </div>

              {/* HUGE TIMES */}
              <div className="text-center py-6 bg-neutral-950 border border-neutral-800">
                <span className="font-mono text-xs text-neutral-400 block tracking-widest">
                  남은 시간 COUNTDOWN
                </span>
                <div className={`font-mono text-7xl md:text-8xl font-black tracking-tighter tabular-nums ${state.timerSeconds < 60 ? "text-red-500 animate-pulse" : "text-white"}`}>
                  {Math.floor(state.timerSeconds / 60)}:{String(state.timerSeconds % 60).padStart(2, "0")}
                </div>
                {myTeamId === "facilitator" ? (
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <button
                      onClick={handleToggleTimer}
                      className="px-3 py-1 bg-white text-black text-xs font-mono font-bold hover:bg-neutral-200 cursor-pointer"
                    >
                      {state.isTimerRunning ? "STOP" : "START"}
                    </button>
                    <button
                      onClick={() => handleResetTimer(state.isFeedbackMode ? 300 : 1800)}
                      className="px-3 py-1 bg-neutral-800 text-neutral-300 text-xs font-mono hover:bg-neutral-700 border border-neutral-700 cursor-pointer"
                    >
                      RESET
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 text-center">
                    <span className="inline-block px-2.5 py-1 text-[10px] bg-neutral-800 text-neutral-400 font-mono tracking-wide rounded-sm border border-neutral-700">
                      🔒 타이머 제어 권한 없음 (관리자 전용)
                    </span>
                  </div>
                )}
              </div>

              {/* Broadcast Guidelines Script */}
              <div className="border border-neutral-700 p-4 bg-neutral-900 font-mono text-xs text-neutral-300 leading-relaxed">
                <p className="font-bold text-white mb-2">📢 퍼실리테이터 공지 가이드라인 :</p>
                {state.isFeedbackMode ? (
                  <span>
                    "현재 {state.currentRound}회차 토론이 완료되었습니다. 각 조는 화면의 피드백 패널에 타 조의 부족한 점을 상세히 고발 및 입력하십시오."
                  </span>
                ) : (
                  <span>
                    "다음 세션({state.currentRound}회차)을 시작합니다. 이번 회차에서는 지난 피드백을 반영하여 안건을 구체화하세요. 논의 시간은 30분입니다."
                  </span>
                )}
              </div>
            </div>

            {/* PROJECTOR TEAM SCOREBOARD TABLE SUMMARY (Occupies 2 cols) */}
            <div className="lg:col-span-2 bg-neutral-950 border border-neutral-700 p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <span className="font-mono text-xs text-neutral-400 tracking-wider block uppercase">
                  [ {state.currentRound}회차 전체 5개 조 안건 및 피드백 현황판 ]
                </span>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-sans text-xs">
                    <thead>
                      <tr className="border-b border-neutral-700 font-mono text-neutral-400 uppercase text-[10px]">
                        <th className="pb-3 text-center w-[12%]">조번호</th>
                        <th className="pb-3 w-[45%]">안건명 및 진척 내용</th>
                        <th className="pb-3 w-[25%] text-center">반영 점검</th>
                        <th className="pb-3 w-[18%] text-center">완성도</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800 text-[11px]">
                      {Object.entries(state.teams).map(([id, t]) => {
                        const team = t as TeamData;
                        const r = (team.rounds[state.currentRound] as RoundData) || {
                          roundNumber: state.currentRound,
                          agendaTitle: "",
                          agendaSummary: "",
                          feasibilityFeedback: "",
                          efficiencyFeedback: "",
                          cultureFeedback: "",
                          improvementDirection: "",
                          nextQuestion: "",
                          completionScore: 0,
                          peerFeedbacks: [],
                        };
                        const checkedCount = r.peerFeedbacks?.filter(c => c.isApplied).length || 0;
                        const totalCount = r.peerFeedbacks?.length || 0;
                        
                        return (
                          <tr key={id} className="hover:bg-neutral-900 border-b border-neutral-850">
                            <td className="py-4 font-mono font-black text-center text-sm">{id}</td>
                            <td className="py-4 space-y-1">
                              <p className="font-bold text-white text-xs">{r.agendaTitle || "안건 미지정"}</p>
                              <p className="text-neutral-400 line-clamp-2 text-[10px] leading-relaxed">
                                {r.agendaSummary || "진행내역 아직 작성되지 않음."}
                              </p>
                            </td>
                            <td className="py-4 text-center text-neutral-300 font-mono text-[10px]">
                              {totalCount > 0 ? (
                                <span className="bg-neutral-800 text-white px-2 py-0.5 border border-neutral-700 font-semibold">
                                  반영됨: {checkedCount}/{totalCount} ({Math.round(checkedCount/totalCount * 100)}%)
                                </span>
                              ) : (
                                <span className="text-neutral-500 italic">등록 대기</span>
                              )}
                            </td>
                            <td className="py-4 text-center">
                              <div className="flex flex-col items-center">
                                <span className="font-mono font-bold text-white text-xs">{r.completionScore || 0}%</span>
                                <div className="w-16 bg-neutral-850 h-1.5 border border-neutral-700 mt-1 overflow-hidden">
                                  <div className="bg-white h-full" style={{ width: `${r.completionScore || 0}%` }}></div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status footer information */}
              <div className="border-t border-neutral-800 pt-4 flex flex-col md:flex-row md:items-center justify-between text-[11px] text-neutral-400 gap-2 font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                  전 서버 전용 모니터 브로드캐스트 작동중 &middot; 나눔스퀘어 네오 글꼴 렌더링 완료
                </span>
                <span className="italic">
                  * 각 조별 단말기에서 기입하는 실시간 정보가 자동 병합됩니다.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 🔮 BEAUTIFUL MONOCHROME ROLE & TEAM FIRST-LOAD SELECTOR OVERLAY */}
      {showSetupModal && (
        <div className="fixed inset-0 bg-neutral-900/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF9F5] border-4 border-black p-6 md:p-8 max-w-xl w-full space-y-6 shadow-2xl relative animate-in fade-in zoom-in duration-300 text-black">
            
            {/* Admin Password Gate Toggled by Top Right Button */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
              {showAdminInput ? (
                <div className="flex items-center gap-1.5 bg-white border border-black p-1 shadow-sm text-xs animate-in slide-in-from-right duration-200">
                  <input
                    type="password"
                    placeholder="관리자 패스코드"
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value);
                      setAdminError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (adminPassword === "2016343") {
                          handleSelectRoleAndTeam("facilitator");
                          setShowAdminInput(false);
                          setAdminPassword("");
                        } else {
                          setAdminError("비밀번호 불일치 (2016343)");
                        }
                      }
                    }}
                    className="w-28 px-1.5 py-1 border border-neutral-300 focus:outline-none focus:border-black text-[11px] font-mono"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      if (adminPassword === "2016343") {
                        handleSelectRoleAndTeam("facilitator");
                        setShowAdminInput(false);
                        setAdminPassword("");
                      } else {
                        setAdminError("비밀번호 불일치 (2016343)");
                      }
                    }}
                    className="px-2 py-1 bg-black text-white hover:bg-neutral-800 text-[10px] font-black font-mono cursor-pointer"
                  >
                    확인
                  </button>
                  <button
                    onClick={() => {
                      setShowAdminInput(false);
                      setAdminError(null);
                      setAdminPassword("");
                    }}
                    className="px-1.5 py-1 text-neutral-400 hover:text-black text-[10px] font-mono cursor-pointer"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAdminInput(true)}
                  className="p-2 border border-black bg-white hover:bg-neutral-100 transition-all rounded shadow-sm hover:scale-105 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  title="관리자 권한 진입"
                >
                  <Lock className="w-3.5 h-3.5 text-neutral-700" />
                  <span className="text-[10px] font-mono font-black text-neutral-600">ADMIN</span>
                </button>
              )}
            </div>

            {/* Header */}
            <div className="border-b-2 border-black pb-4 text-left space-y-1">
              <h2 className="text-xl font-black text-black">본부 간 업무효율화 간담회</h2>
              <p className="text-[11px] text-neutral-550 font-sans leading-relaxed">
                참석하시는 소속 조를 클릭해 주십시오.
              </p>
            </div>

            {/* Password Validation Error Message */}
            {adminError && (
              <div className="p-2.5 bg-red-50 border border-red-300 text-red-700 text-xs font-mono flex items-center gap-2 animate-pulse">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>입력한 접속 패스코드가 올바르지 않습니다.</span>
              </div>
            )}

            {/* Clean, Simple Team Buttons List */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {["1조", "2조", "3조", "4조", "5조"].map((teamId) => {
                  return (
                    <button
                      key={teamId}
                      onClick={() => handleSelectRoleAndTeam(teamId)}
                      className="bg-white border-2 border-black hover:bg-black hover:text-white p-4 py-6 text-center transition font-black text-base shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 cursor-pointer flex flex-col items-center justify-center min-h-[60px]"
                    >
                      <span className="font-sans font-black tracking-tight">{teamId}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
