import React, { useState } from "react";
import { HackathonState, TeamData, RoundData, ChecklistItem } from "../types";

interface FacilitatorDashboardProps {
  state: HackathonState;
  onSetTeamTab: (teamId: string) => void;
  onUpdateRoundDataForTeam: (teamId: string, roundNum: number, data: any) => void;
  onAdminClickTeamCard?: (teamId: string) => void;
  myTeamId?: string | null;
}

export default function FacilitatorDashboard({
  state,
  onSetTeamTab,
  onUpdateRoundDataForTeam,
  onAdminClickTeamCard,
  myTeamId,
}: FacilitatorDashboardProps) {
  const [showDetailModal, setShowDetailModal] = useState<{
    teamId: string;
    roundNum: number;
  } | null>(null);

  const [selectedDetailTeamId, setSelectedDetailTeamId] = useState<string>("1조");
  const [additionalFeedbackText, setAdditionalFeedbackText] = useState<string>("");

  const activeRoundNum = state.currentRound;
  const selectedTeam = state.teams[selectedDetailTeamId] as TeamData;
  const currentRoundData = (selectedTeam?.rounds[activeRoundNum] as RoundData) || {
    roundNumber: activeRoundNum,
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

  const getAccumulatedPeerFeedbacksInDashboard = (): (ChecklistItem & { _originRound?: number })[] => {
    const accumulated: (ChecklistItem & { _originRound?: number })[] = [];
    const seenIds = new Set<string>();
    for (let r = 1; r <= activeRoundNum; r++) {
      const rData = selectedTeam?.rounds[r];
      if (rData && rData.peerFeedbacks) {
        rData.peerFeedbacks.forEach((item) => {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            accumulated.push({
              ...item,
              _originRound: r
            });
          }
        });
      }
    }
    return accumulated;
  };

  const handleFieldChangeInDashboard = (key: string, value: any) => {
    onUpdateRoundDataForTeam(selectedDetailTeamId, activeRoundNum, { [key]: value });
  };

  const handleToggleApplyInDashboard = (itemId: string) => {
    for (let r = 1; r <= activeRoundNum; r++) {
      const rData = selectedTeam?.rounds[r];
      if (rData && rData.peerFeedbacks && rData.peerFeedbacks.some(item => item.id === itemId)) {
        const updated = rData.peerFeedbacks.map((item) =>
          item.id === itemId ? { ...item, isApplied: !item.isApplied, isDeleted: false, checked: !item.isApplied } : item
        );
        onUpdateRoundDataForTeam(selectedDetailTeamId, r, { peerFeedbacks: updated });
        return;
      }
    }
  };

  const handleToggleDeleteInDashboard = (itemId: string) => {
    for (let r = 1; r <= activeRoundNum; r++) {
      const rData = selectedTeam?.rounds[r];
      if (rData && rData.peerFeedbacks && rData.peerFeedbacks.some(item => item.id === itemId)) {
        const updated = rData.peerFeedbacks.map((item) =>
          item.id === itemId ? { ...item, isDeleted: !item.isDeleted, isApplied: false, checked: false } : item
        );
        onUpdateRoundDataForTeam(selectedDetailTeamId, r, { peerFeedbacks: updated });
        return;
      }
    }
  };

  const handleDeleteInDashboard = (itemId: string) => {
    for (let r = 1; r <= activeRoundNum; r++) {
      const rData = selectedTeam?.rounds[r];
      if (rData && rData.peerFeedbacks && rData.peerFeedbacks.some(item => item.id === itemId)) {
        const updated = rData.peerFeedbacks.filter((item) => item.id !== itemId);
        onUpdateRoundDataForTeam(selectedDetailTeamId, r, { peerFeedbacks: updated });
        return;
      }
    }
  };

  const handleAddAdditionalFeedbackInDashboard = () => {
    if (!additionalFeedbackText.trim()) return;
    const peerFeedbacksList = currentRoundData.peerFeedbacks || [];
    
    let teamLabel = "M";
    const id = myTeamId || "facilitator";
    if (id === "facilitator") {
      teamLabel = "M";
    } else {
      const match = id.match(/(\d+)/);
      if (match) {
        teamLabel = `${parseInt(match[1])}조`;
      } else {
        teamLabel = id;
      }
    }

    const newItem: ChecklistItem = {
      id: "dash_added_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      text: `${teamLabel} ㅣ ${additionalFeedbackText.trim()}`,
      checked: false,
    };
    handleFieldChangeInDashboard("peerFeedbacks", [...peerFeedbacksList, newItem]);
    setAdditionalFeedbackText("");
  };

  const handleImportPreviousFeedbackInDashboard = () => {
    if (activeRoundNum <= 1) return;
    const prevRoundNum = activeRoundNum - 1;
    const prevRound = selectedTeam.rounds[prevRoundNum];
    if (!prevRound) return;

    const itemsToAdd: string[] = [];
    if (prevRound.feasibilityFeedback) itemsToAdd.push(`[1회차 실행 가능성 피드백] ${prevRound.feasibilityFeedback}`);
    if (prevRound.efficiencyFeedback) itemsToAdd.push(`[1회차 비용/시간 효율 피드백] ${prevRound.efficiencyFeedback}`);
    if (prevRound.cultureFeedback) itemsToAdd.push(`[1회차 조직 정합성 피드백] ${prevRound.cultureFeedback}`);
    if (prevRound.nextQuestion) itemsToAdd.push(`[1회차 퍼실리테이터 의문] ${prevRound.nextQuestion}`);

    const newItems = itemsToAdd.map((text, idx) => ({
      id: `imported_dash_${prevRoundNum}_${idx}_${Date.now()}`,
      text: text,
      checked: false,
    }));

    const checklist = currentRoundData.appliedChecklist || [];
    handleFieldChangeInDashboard("appliedChecklist", [...checklist, ...newItems]);
  };

  return (
    <div className="space-y-8" id="facilitator-dashboard-root">
      
      {/* Overview Stat Widgets */}
      <div>
        <p className="text-xs font-mono font-bold text-neutral-500 uppercase tracking-widest mb-2 text-center md:text-left">
          [ 📊 실시간 진행 상황 캡처 - 각 조 클릭 시 상세 피드백 제어로 전송 / 참가자 화면 실시간 내비게이션 ]
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {Object.entries(state.teams).map(([id, team]) => {
            const roundData = team.rounds[activeRoundNum];
            const score = roundData?.completionScore || 0;
            const isChecklistEmpty = !roundData?.peerFeedbacks || roundData.peerFeedbacks.length === 0;
            const checkedCount = roundData?.peerFeedbacks?.filter(c => c.isApplied).length || 0;
            const totalCount = roundData?.peerFeedbacks?.length || 0;
            const isSelected = selectedDetailTeamId === id;

            return (
              <button
                key={id}
                onClick={() => {
                  setSelectedDetailTeamId(id);
                  onAdminClickTeamCard?.(id);
                }}
                className={`bg-white border text-left hover:bg-neutral-50 transition flex flex-col justify-between h-[130px] cursor-pointer p-4 relative ${
                  isSelected 
                    ? "border-4 border-black ring-4 ring-neutral-200" 
                    : "border-black"
                }`}
                style={{ borderWidth: isSelected ? "4px" : "1px" }}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`font-mono text-xs font-black px-1.5 py-0.5 border border-black ${isSelected ? "bg-black text-white" : "bg-neutral-100 text-black"}`}>
                    {id}
                  </span>
                  <span className="font-mono text-xs font-bold text-neutral-800">{score}%</span>
                </div>
                <p className="text-xs font-bold text-neutral-900 truncate w-full mt-2">
                  {roundData?.agendaTitle || "안건명 미기재"}
                </p>
                
                <div className="w-full mt-3 space-y-1">
                  <div className="flex justify-between items-center text-[10px] text-neutral-500 font-mono">
                    <span className="font-bold text-black border-b border-black">피드백 반영</span>
                    <span>{isChecklistEmpty ? "없음" : `${checkedCount}/${totalCount}`}</span>
                  </div>
                  <div className="w-full bg-neutral-100 h-1.5 border border-neutral-300 overflow-hidden">
                    <div
                      className="bg-black h-full transition-all duration-300"
                      style={{ width: `${score}%` }}
                    ></div>
                  </div>
                </div>

                {isSelected && (
                  <div className="absolute top-1 right-1 bg-black text-white text-[8px] font-mono font-bold px-1 uppercase tracking-widest leading-normal">
                    Viewing
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* DYNAMIC FEEDBACK CONTROLLER DETAIL PANEL */}
      {selectedTeam && (
        <div className="bg-white border-2 border-black p-5 md:p-6 space-y-6" id="dashboard-team-detail-panel">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 border-neutral-500 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-black text-white font-mono text-xs font-extrabold uppercase">
                  {selectedDetailTeamId} DETAILED SCREEN CONTROL PANEL
                </span>
                <span className="text-[11px] font-mono text-neutral-500">
                  {activeRoundNum}회차 진행 중
                </span>
              </div>
              <h3 className="text-lg font-black text-black tracking-tight mt-1">
                📌 {selectedDetailTeamId} : {currentRoundData.agendaTitle || "(안건명 미정)"}
              </h3>
            </div>
            
            <div className="flex items-center gap-2">
              {myTeamId === "facilitator" || myTeamId === selectedDetailTeamId ? (
                <button
                  onClick={() => onSetTeamTab(selectedDetailTeamId)}
                  className="px-3 py-1.5 bg-black text-white hover:bg-neutral-800 font-bold transition text-xs font-mono uppercase cursor-pointer"
                >
                  이동하여 직접 편집 (Go to Board) &rarr;
                </button>
              ) : (
                <span className="px-3 py-1.5 bg-neutral-100 border border-neutral-300 text-neutral-400 font-bold text-xs uppercase cursor-not-allowed select-none flex items-center gap-1">
                  🔒 타 조 안건 편집 제한
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* L-Column: Agenda Topic and Discussion summary displayed dynamically */}
            <div className="space-y-5">
              <div className="border-b border-black pb-2">
                <h4 className="text-xs font-black uppercase text-neutral-800 tracking-wider">
                  [ 1. {activeRoundNum}회차 등록된 효율화 안건 및 논의내용 ]
                </h4>
              </div>

              <div className="space-y-4">
                {/* Agenda Topic / Title */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-neutral-700 block uppercase tracking-wider">
                    📋 효율화 안건 주제
                  </span>
                  <div className="w-full bg-neutral-50 border border-black p-3 text-xs text-neutral-900 font-bold leading-relaxed whitespace-pre-wrap min-h-[48px]">
                    {currentRoundData.agendaTitle ? (
                      currentRoundData.agendaTitle
                    ) : (
                      <span className="text-neutral-400 font-normal italic">등록된 효율화 안건 주제가 없습니다.</span>
                    )}
                  </div>
                </div>

                {/* Agenda Summary / Discussion content */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-neutral-700 block uppercase tracking-wider">
                    💬 현재 안건 요약 및 논의내용
                  </span>
                  <div className="w-full bg-neutral-50 border border-black p-3 text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap min-h-[120px] max-h-[200px] overflow-y-auto">
                    {currentRoundData.agendaSummary ? (
                      currentRoundData.agendaSummary
                    ) : (
                      <span className="text-neutral-400 font-normal italic">현재 기록된 일관 논의내용이 대기 중입니다.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* R-Column: Round 2 Tracking of preceding feeds & Additional feed inputs */}
            <div className="space-y-4 bg-neutral-50 p-4 border border-neutral-300">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-neutral-800 tracking-wider">
                  [ 2. 실시간 타 조 피드백 현황 및 관리 &middot; 대시보드 연동 ]
                </h4>
              </div>

              <div className="space-y-2">
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {(() => {
                    const accumulatedList = getAccumulatedPeerFeedbacksInDashboard();
                    if (accumulatedList.length === 0) {
                      return (
                        <p className="text-xs text-neutral-400 italic text-center py-4 bg-white border border-neutral-200">
                          등록된 피드백이 없습니다. 하단에서 돌발 질문이나 피드백을 직접 추가하십시오.
                        </p>
                      );
                    }

                    return accumulatedList.map((item) => {
                      const isItemApplied = !!item.isApplied;
                      const isItemDeleted = !!item.isDeleted;
                      return (
                        <div
                          key={item.id}
                          className={`flex items-start justify-between gap-3 p-2 border transition-all ${
                            isItemApplied
                              ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                              : isItemDeleted
                              ? "bg-neutral-50 border-neutral-200 text-neutral-400 opacity-60"
                              : "bg-white border-neutral-200 text-neutral-800"
                          }`}
                        >
                          <div className="flex-1 flex items-start gap-1.5 min-w-0">
                            <span className="shrink-0 px-1 py-0.5 text-[8px] font-mono font-black bg-neutral-200 text-neutral-800 border border-neutral-300 rounded uppercase">
                              R{item._originRound || activeRoundNum}
                            </span>
                            <span
                              className={`text-[11px] leading-relaxed break-all ${
                                isItemDeleted ? "line-through text-neutral-400 decoration-neutral-400" : "font-medium"
                              }`}
                            >
                              {item.text}
                            </span>
                          </div>
                          
                          <div className="flex gap-1.5 shrink-0 items-center">
                            {isItemApplied && (
                              <span className="px-1.5 py-0.5 text-[9px] bg-emerald-600 text-white font-bold rounded-sm">
                                적용됨
                              </span>
                            )}
                            {isItemDeleted && (
                              <span className="px-1.5 py-0.5 text-[9px] bg-red-650 text-white font-bold rounded-sm text-xs select-none">
                                제외됨
                              </span>
                            )}
                            {!isItemApplied && !isItemDeleted && (
                              <span className="px-1.5 py-0.5 text-[9px] bg-neutral-100 text-neutral-500 font-bold border border-neutral-300 rounded-sm">
                                검토중
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Add New Additional Peer Feedbacks (추가 피드백 받으면 표시되도록해줘) */}
              <div className="border-t pt-3 border-neutral-300 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-neutral-700 block">➕ 추가 피드백 실시간 접수 (Peer Critic Adder)</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="px-3 py-1.5 border border-black text-xs font-bold font-mono bg-neutral-100 shrink-0 select-none text-neutral-800 flex items-center justify-center min-w-[45px]">
                    {(() => {
                      const id = myTeamId || "facilitator";
                      if (id === "facilitator") return "M";
                      const match = id.match(/(\d+)/);
                      return match ? `${parseInt(match[1])}조` : "M";
                    })()}
                  </div>
                  <input
                    type="text"
                    value={additionalFeedbackText}
                    onChange={(e) => setAdditionalFeedbackText(e.target.value)}
                    placeholder="돌발 질문이나 돌발 피드백 기안 입력..."
                    className="flex-1 border border-black p-2 bg-white text-xs text-neutral-800 font-sans focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddAdditionalFeedbackInDashboard();
                    }}
                  />
                  <button
                    onClick={handleAddAdditionalFeedbackInDashboard}
                    className="px-4 py-2 bg-black text-white text-xs font-mono hover:bg-neutral-800 transition cursor-pointer shrink-0"
                  >
                    등록
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
