import React, { useState } from "react";
import { TeamData, RoundData, ChecklistItem } from "../types";

interface TeamWorkspaceProps {
  team: TeamData;
  currentRound: number;
  onUpdateRoundData: (roundNum: number, updated: Partial<RoundData>) => void;
  isReadOnly: boolean;
  myTeamId?: string;
  allTeams?: { [teamId: string]: TeamData };
  onUpdateRoundDataForTeam?: (teamId: string, roundNum: number, updatedFields: any) => void;
}

export default function TeamWorkspace({
  team,
  currentRound,
  onUpdateRoundData,
  isReadOnly,
  myTeamId,
  allTeams,
  onUpdateRoundDataForTeam,
}: TeamWorkspaceProps) {
  const [selectedRoundTab, setSelectedRoundTab] = useState<number>(currentRound);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [newFeedbackText, setNewFeedbackText] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState("실행 가능성");

  // Sync selectedRoundTab if currentRound changes
  React.useEffect(() => {
    setSelectedRoundTab(currentRound);
  }, [currentRound]);

  const activeRoundData = team.rounds[selectedRoundTab] || {
    roundNumber: selectedRoundTab,
    agendaTitle: "",
    agendaSummary: "",
    feasibilityFeedback: "",
    efficiencyFeedback: "",
    cultureFeedback: "",
    improvementDirection: "",
    nextQuestion: "",
    completionScore: 20,
    appliedChecklist: [],
    peerFeedbacks: [],
  };

  const isItemAuthor = (item: ChecklistItem) => {
    const currentMyId = myTeamId || "facilitator";
    if (currentMyId === "facilitator") return true; 
    
    if (item.authorId) {
      return item.authorId === currentMyId;
    }
    
    const text = item.text.trim();
    if (text.startsWith(currentMyId)) {
      return true;
    }
    const match = currentMyId.match(/^(\d+)조/);
    if (match) {
      const parsedTeamName = `${match[1]}조`;
      return text.startsWith(parsedTeamName);
    }
    return false;
  };

  const getAccumulatedPeerFeedbacks = (): (ChecklistItem & { _originRound?: number })[] => {
    const accumulated: (ChecklistItem & { _originRound?: number })[] = [];
    const seenIds = new Set<string>();
    for (let r = 1; r <= selectedRoundTab; r++) {
      const rData = team.rounds[r];
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

  const handleToggleSentFeedbackStatus = (targetTeamId: string, itemId: string, action: "apply" | "delete") => {
    if (!allTeams || !onUpdateRoundDataForTeam) return;
    const targetTeam = allTeams[targetTeamId];
    if (!targetTeam) return;

    for (let r = 1; r <= selectedRoundTab; r++) {
      const roundData = targetTeam.rounds[r];
      if (roundData && roundData.peerFeedbacks && roundData.peerFeedbacks.some(item => item.id === itemId)) {
        const updatedFeedbacks = roundData.peerFeedbacks.map((item) => {
          if (item.id === itemId) {
            if (action === "apply") {
              const nextApplied = !item.isApplied;
              return { ...item, isApplied: nextApplied, isDeleted: false, checked: nextApplied };
            } else {
              const nextDeleted = !item.isDeleted;
              return { ...item, isDeleted: nextDeleted, isApplied: false, checked: false };
            }
          }
          return item;
        });
        onUpdateRoundDataForTeam(targetTeamId, r, { peerFeedbacks: updatedFeedbacks });
        return;
      }
    }
  };

  const handleDeleteSentFeedback = (targetTeamId: string, itemId: string) => {
    if (!allTeams || !onUpdateRoundDataForTeam) return;
    const targetTeam = allTeams[targetTeamId];
    if (!targetTeam) return;

    for (let r = 1; r <= selectedRoundTab; r++) {
      const roundData = targetTeam.rounds[r];
      if (roundData && roundData.peerFeedbacks && roundData.peerFeedbacks.some(item => item.id === itemId)) {
        const updatedFeedbacks = roundData.peerFeedbacks.filter(item => item.id !== itemId);
        onUpdateRoundDataForTeam(targetTeamId, r, { peerFeedbacks: updatedFeedbacks });
        return;
      }
    }
  };

  const handleFieldChange = (key: keyof RoundData, value: any) => {
    if (isReadOnly) return;
    onUpdateRoundData(selectedRoundTab, { [key]: value });
  };

  const handleToggleApplyPeerFeedback = (id: string) => {
    if (isReadOnly) return;
    for (let r = 1; r <= selectedRoundTab; r++) {
      const rData = team.rounds[r];
      if (rData && rData.peerFeedbacks && rData.peerFeedbacks.some(item => item.id === id)) {
        const updated = rData.peerFeedbacks.map((item) =>
          item.id === id ? { ...item, isApplied: !item.isApplied, isDeleted: false, checked: !item.isApplied } : item
        );
        onUpdateRoundData(r, { peerFeedbacks: updated });
        return;
      }
    }
  };

  const handleToggleDeletePeerFeedback = (id: string) => {
    if (isReadOnly) return;
    for (let r = 1; r <= selectedRoundTab; r++) {
      const rData = team.rounds[r];
      if (rData && rData.peerFeedbacks && rData.peerFeedbacks.some(item => item.id === id)) {
        const updated = rData.peerFeedbacks.map((item) =>
          item.id === id ? { ...item, isDeleted: !item.isDeleted, isApplied: false, checked: false } : item
        );
        onUpdateRoundData(r, { peerFeedbacks: updated });
        return;
      }
    }
  };

  const handleAddPeerFeedback = () => {
    if (!newFeedbackText.trim()) return;
    const currentList = activeRoundData.peerFeedbacks || [];
    
    let teamLabel = "M";
    const id = myTeamId || "facilitator";
    if (id === "facilitator") {
      teamLabel = "M";
    } else {
      const match = id.match(/(\d+)/);
      if (match) {
        teamLabel = `${parseInt(match[1])}조`;
      } else {
        teamLabel = id === "선택안됨" ? "1조" : id;
      }
    }

    const newItem: ChecklistItem = {
      id: "peer_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      text: `${teamLabel} ㅣ ${newFeedbackText.trim()}`,
      checked: false,
      authorId: myTeamId || "facilitator",
    };
    onUpdateRoundData(selectedRoundTab, {
      peerFeedbacks: [...currentList, newItem]
    });
    setNewFeedbackText("");
  };

  const handleDeletePeerFeedback = (id: string) => {
    if (isReadOnly) return;
    for (let r = 1; r <= selectedRoundTab; r++) {
      const rData = team.rounds[r];
      if (rData && rData.peerFeedbacks && rData.peerFeedbacks.some(item => item.id === id)) {
        const updated = rData.peerFeedbacks.filter((item) => item.id !== id);
        onUpdateRoundData(r, { peerFeedbacks: updated });
        return;
      }
    }
  };

  // Add a new checklist item to evaluation list
  const [customCheckItem, setCustomCheckItem] = useState("");
  const handleAddCheckItem = () => {
    if (isReadOnly) return;
    if (!customCheckItem.trim()) return;
    const newItem: ChecklistItem = {
      id: "item_" + Date.now(),
      text: customCheckItem.trim(),
      checked: false,
    };
    const currentList = activeRoundData.appliedChecklist || [];
    handleFieldChange("appliedChecklist", [...currentList, newItem]);
    setCustomCheckItem("");
  };

  // Toggle feedback checklist item
  const handleToggleCheckItem = (id: string) => {
    if (isReadOnly) return;
    const currentList = activeRoundData.appliedChecklist || [];
    const updated = currentList.map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    handleFieldChange("appliedChecklist", updated);
  };

  // Delete feedback checklist item
  const handleDeleteCheckItem = (id: string) => {
    if (isReadOnly) return;
    const currentList = activeRoundData.appliedChecklist || [];
    const updated = currentList.filter((item) => item.id !== id);
    handleFieldChange("appliedChecklist", updated);
  };

  // Create auto checklist items from previous round's comments
  const handleImportPreviousFeedbackAsChecklist = () => {
    if (isReadOnly) return;
    if (selectedRoundTab <= 1) return;
    const prevRoundNum = selectedRoundTab - 1;
    const prevRound = team.rounds[prevRoundNum];
    if (!prevRound) return;

    const itemsToAdd: string[] = [];
    if (prevRound.feasibilityFeedback) itemsToAdd.push(`[실행 가능성 피드백 해결] ${prevRound.feasibilityFeedback.substring(0, 50)}...`);
    if (prevRound.efficiencyFeedback) itemsToAdd.push(`[효율성 피드백 해결] ${prevRound.efficiencyFeedback.substring(0, 50)}...`);
    if (prevRound.cultureFeedback) itemsToAdd.push(`[조직문화 피드백 해결] ${prevRound.cultureFeedback.substring(0, 50)}...`);
    if (prevRound.nextQuestion) itemsToAdd.push(`[이전 질문 답변 완료] ${prevRound.nextQuestion.substring(0, 50)}...`);

    const newItems: ChecklistItem[] = itemsToAdd.map((text, idx) => ({
      id: `imported_${prevRoundNum}_${idx}_${Date.now()}`,
      text: text,
      checked: false,
    }));

    const currentList = activeRoundData.appliedChecklist || [];
    handleFieldChange("appliedChecklist", [...currentList, ...newItems]);
  };

  // Call Express API proxies to Gemini for instant professional feedback design
  const handleRequestAiCoPilot = async () => {
    setIsAiLoading(true);
    setAiError(null);

    // Collect preceding round's summary or notes
    const previousRoundData = selectedRoundTab > 1 ? team.rounds[selectedRoundTab - 1] : null;
    const prevFeedbackText = previousRoundData 
      ? `이전 ${selectedRoundTab - 1}회차 안건: ${previousRoundData.agendaTitle}`
      : "없음 (최초 회차)";

    try {
      const response = await fetch("/api/ai-facilitator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: team.teamId,
          currentRound: selectedRoundTab,
          agendaTitle: activeRoundData.agendaTitle,
          agendaSummary: activeRoundData.agendaSummary,
          feasibilityFeedback: "",
          efficiencyFeedback: "",
          cultureFeedback: "",
          previousFeedback: prevFeedbackText,
        }),
      });

      if (!response.ok) {
        throw new Error("서버와의 통신이 원활하지 않습니다.");
      }

      const data = await response.json();
      if (data) {
        const currentList = activeRoundData.peerFeedbacks || [];
        const newAiItems: ChecklistItem[] = [];
        if (data.feasibility) {
          newAiItems.push({
            id: `ai_feasibility_${Date.now()}`,
            text: `[실행 가능성] ${data.feasibility}`,
            checked: false,
          });
        }
        if (data.efficiency) {
          newAiItems.push({
            id: `ai_efficiency_${Date.now()}`,
            text: `[비용 효율] ${data.efficiency}`,
            checked: false,
          });
        }
        if (data.culture) {
          newAiItems.push({
            id: `ai_culture_${Date.now()}`,
            text: `[조직문화] ${data.culture}`,
            checked: false,
          });
        }
        onUpdateRoundData(selectedRoundTab, {
          peerFeedbacks: [...currentList, ...newAiItems],
          completionScore: Math.min(activeRoundData.completionScore + 15, 100),
        });
      }
    } catch (err: any) {
      console.error(err);
      setAiError("로컬 템플릿 피드백으로 대체 발행했습니다.");
      
      // Dynamic fallback
      const mockFeas = "부서간 명확한 업무 이관 합의선(SLA)이 조율되어야 실제 현동 가능함. 시스템 기상 혜택 도입 필요.";
      const mockEff = "초기 프로세스 전수 조사 및 매핑 공수 대비 누적 가치 회수 기간은 약 4.5개월로 초양호함.";
      const mockCult = "수동적인 회의 대신 텍스트 보고를 지나치게 선점하면 실무자 간의 '냉소주의'나 '불통'을 낳을 수 있음.";
      
      const currentList = activeRoundData.peerFeedbacks || [];
      onUpdateRoundData(selectedRoundTab, {
        peerFeedbacks: [
          ...currentList,
          { id: `ai_f_mock_${Date.now()}`, text: `[실행 가능성] ${mockFeas}`, checked: false },
          { id: `ai_e_mock_${Date.now()}`, text: `[비용 효율] ${mockEff}`, checked: false },
          { id: `ai_c_mock_${Date.now()}`, text: `[조직문화] ${mockCult}`, checked: false },
        ],
        completionScore: Math.min(activeRoundData.completionScore + 15, 100),
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="bg-white border border-black p-6 md:p-8 space-y-6" id={`team-workspace-${team.teamId}`}>
      {/* Read Only or Authorized Banner */}
      {isReadOnly ? (
        <div className="bg-amber-50 border-2 border-black text-neutral-900 p-4 font-mono text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🔒</span>
            <div>
              <p className="font-bold uppercase text-amber-900">[ 다른 조 작업 공간 &middot; 읽기 전용 상태 ]</p>
              <p className="font-sans text-[11px] text-neutral-600 mt-0.5">
                귀하는 현재 <strong className="font-black underline underline-offset-2 text-black">{myTeamId || "선택안됨"}</strong> 소속입니다. 
                이 공간({team.teamId})의 내용은 수정 및 위조가 불가능합니다 (참관 전용).
              </p>
            </div>
          </div>
          <span className="shrink-0 px-2.5 py-1 bg-neutral-900 text-white font-bold uppercase text-[10px] tracking-wider">READ ONLY</span>
        </div>
      ) : (
        <div className="bg-emerald-50 border-2 border-emerald-500 text-black p-4 font-mono text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">✍️</span>
            <div>
              <p className="font-bold uppercase text-emerald-800">[ 편집 권한 획득 &middot; 수정 가능 상태 ]</p>
              <p className="font-sans text-[11px] text-neutral-600 mt-0.5 font-medium">
                귀하는 <strong className="font-black underline underline-offset-2 text-emerald-800">{myTeamId}</strong> 소속입니다! 
                실시간 아고라 논의 내용과 혁신 과제서를 마음껏 수정하고 저장하실 수 있습니다.
              </p>
            </div>
          </div>
          <span className="shrink-0 px-2.5 py-1 bg-emerald-600 text-white font-bold uppercase text-[10px] tracking-wider animate-pulse">AUTHORISED</span>
        </div>
      )}

      {/* Header Info Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-black pb-4 gap-4">
        <div>
          <span className="font-mono text-xs px-2.5 py-1 bg-black text-white uppercase tracking-wider">
            {team.teamId} WORKSPACE {isReadOnly && "(READ-ONLY)"}
          </span>
          <h3 className="text-xl font-bold text-black mt-2 tracking-tight">
            {activeRoundData.agendaTitle || "안건을 등록해 주십시오"}
          </h3>
        </div>

        {/* Progress Slider Display */}
        <div className="flex flex-col sm:items-end min-w-[200px]">
          <div className="flex items-center justify-between w-full text-xs font-mono font-bold text-neutral-500">
            <span>PROPOSAL COMPLETION</span>
            <span className="text-black font-mono">{activeRoundData.completionScore}%</span>
          </div>
          <div className="w-full bg-neutral-100 border border-neutral-300 h-2 mt-1 relative overflow-hidden">
            <div
              className="bg-black h-full transition-all duration-300"
              style={{ width: `${activeRoundData.completionScore}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Round-selection Inner TABS */}
      <div className="flex flex-wrap border border-black p-1 bg-neutral-50">
        {[1, 2, 3, 4].map((rNum) => {
          const isSelected = selectedRoundTab === rNum;
          return (
            <button
              key={rNum}
              onClick={() => setSelectedRoundTab(rNum)}
              className={`flex-1 text-xs py-2 font-mono border transition ${
                isSelected
                  ? "bg-black text-white border-black font-bold"
                  : "bg-transparent text-neutral-500 border-transparent hover:text-black hover:bg-neutral-100"
              }`}
            >
              ROUND {rNum} {currentRound === rNum ? "(ACTIVE)" : ""}
            </button>
          );
        })}
      </div>

      {/* Core Forms Segment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-5">
          {/* Section 1: Agenda Title & Summary */}
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider font-bold text-neutral-700">
              [ 1. 효율화 안건명 ]
            </label>
            <input
              type="text"
              value={activeRoundData.agendaTitle}
              onChange={(e) => handleFieldChange("agendaTitle", e.target.value)}
              placeholder={isReadOnly ? "타 조의 안건 기입 대기중..." : "예: 회의 전 사전 공유 의무제 수립안"}
              className="w-full p-2.5 border border-black text-sm bg-white font-sans focus:outline-none focus:ring-1 focus:ring-black placeholder-neutral-400 disabled:opacity-75 disabled:bg-neutral-50 disabled:cursor-not-allowed"
              disabled={isReadOnly}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider font-bold text-neutral-700">
              [ 2. 현재 안건 요약 및 진척 내용 ]
            </label>
            <textarea
              rows={4}
              value={activeRoundData.agendaSummary}
              onChange={(e) => handleFieldChange("agendaSummary", e.target.value)}
              placeholder={isReadOnly ? "조별 작업 내역 대기중..." : "현재 진행 중인 토론 사항 및 비효율 해결방안을 요약하여 기록해 주십시오."}
              className="w-full p-2.5 border border-black text-sm bg-white font-sans focus:outline-none focus:ring-1 focus:ring-black placeholder-neutral-400 leading-relaxed disabled:opacity-75 disabled:bg-neutral-50 disabled:cursor-not-allowed"
              disabled={isReadOnly}
            />
          </div>

          {/* Score Slider widget */}
          <div className="space-y-2 p-4 border border-neutral-200">
            <span className="block text-xs uppercase tracking-wider font-bold text-neutral-700">
              [ 3. 정성적 안건 완성도 평가 ({activeRoundData.completionScore}%) ]
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={activeRoundData.completionScore}
              onChange={(e) => handleFieldChange("completionScore", parseInt(e.target.value))}
              className="w-full cursor-pointer accent-black bg-neutral-200 h-1 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* Column 2: Feedback & Improvements */}
        <div className="space-y-5">
          <div className="p-4 border border-black bg-neutral-50 space-y-4">
            <div className="flex items-center justify-between border-b border-black pb-2">
              <span className="text-xs font-mono font-black text-black">
                [ PEER FEEDBACK RECEIVED / 타 조의 핵심 피드백 ]
              </span>
              {!isReadOnly && (
                <button
                  onClick={handleRequestAiCoPilot}
                  disabled={isAiLoading}
                  className="text-xs font-mono font-bold px-3 py-1.5 bg-black text-white border border-black hover:bg-white hover:text-black transition uppercase cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isAiLoading ? "ANALYZING..." : "AI 퍼실리테이터 조언 요청 ✦"}
                </button>
              )}
            </div>
            {aiError && (
              <p className="text-[11px] text-neutral-500 font-mono italic bg-white p-2 border border-neutral-200">
                {aiError}
              </p>
            )}

            {/* Checklist of peer feedback received */}
            <div className="space-y-2 max-h-[750px] overflow-y-auto pr-1">
              {(() => {
                const accumulatedList = getAccumulatedPeerFeedbacks();
                if (accumulatedList.length === 0) {
                  return (
                    <p className="text-xs text-neutral-400 italic text-center py-8 bg-white border border-neutral-200">
                      등록된 피드백 항목이 없습니다.
                    </p>
                  );
                }

                return accumulatedList.map((item) => {
                  const isItemApplied = !!item.isApplied;
                  const isItemDeleted = !!item.isDeleted;
                  const canModify = !isReadOnly;
                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border transition-all ${
                        isItemApplied
                          ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                          : isItemDeleted
                          ? "bg-neutral-50 border-neutral-200 text-neutral-400 opacity-60"
                          : "bg-white border-neutral-200 text-neutral-800"
                      }`}
                    >
                      <div className="flex-1 flex items-start gap-1.5">
                        <span className="shrink-0 px-1 py-0.5 text-[8px] font-mono font-black bg-neutral-200 text-neutral-800 border border-neutral-300 rounded uppercase">
                          R{item._originRound || selectedRoundTab}
                        </span>
                        <span
                          className={`text-xs leading-relaxed ${
                            isItemDeleted ? "line-through text-neutral-400 decoration-neutral-400" : "font-medium"
                          }`}
                        >
                          {item.text}
                        </span>
                      </div>
                      
                      <div className="flex gap-1.5 shrink-0 self-end sm:self-center">
                        {!canModify ? (
                          <>
                            {isItemApplied && (
                              <span className="px-2 py-0.5 text-[10px] bg-emerald-600 text-white font-bold rounded-sm">
                                적용됨
                              </span>
                            )}
                            {isItemDeleted && (
                              <span className="px-2 py-0.5 text-[10px] bg-neutral-400 text-white font-bold rounded-sm">
                                제외됨
                              </span>
                            )}
                            {!isItemApplied && !isItemDeleted && (
                              <span className="px-2 py-0.5 text-[10px] bg-neutral-100 text-neutral-500 font-bold border border-neutral-300 rounded-sm">
                                검토중
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleToggleApplyPeerFeedback(item.id)}
                              className={`px-2 py-1 text-[10px] font-bold border transition-colors cursor-pointer rounded-sm ${
                                isItemApplied
                                  ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                                  : "bg-white text-emerald-700 border-neutral-300 hover:bg-neutral-50"
                              }`}
                            >
                              {isItemApplied ? "✓ 적용됨" : "적용"}
                            </button>
                            <button
                              onClick={() => handleToggleDeletePeerFeedback(item.id)}
                              className={`px-2 py-1 text-[10px] font-bold border transition-colors cursor-pointer rounded-sm ${
                                isItemDeleted
                                  ? "bg-red-650 text-white border-red-650 hover:bg-red-700"
                                  : "bg-white text-red-700 border-neutral-300 hover:bg-neutral-50"
                              }`}
                            >
                              {isItemDeleted ? "✓ 제외됨" : "삭제"}
                            </button>
                          </>
                        )}
                        {canModify && (
                          <button
                            onClick={() => handleDeletePeerFeedback(item.id)}
                            className="text-xs text-neutral-400 hover:text-black font-mono font-bold px-1"
                            title="아예 삭제"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Outgoing Feedback Control Panel */}
            {allTeams && myTeamId && myTeamId !== "facilitator" && myTeamId !== "선택안됨" && (
              <div className="border-t border-black pt-4 mt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-black text-black block uppercase tracking-wider">
                    [ 📢 우리 조 ({myTeamId}) 가 타 조에 제시한 크리틱 목록 및 직접 조율 ]
                  </span>
                </div>
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {(() => {
                    const mySentFeedbacks: { targetTeamId: string; item: ChecklistItem; _originRound?: number }[] = [];
                    Object.entries(allTeams).forEach(([teamId, otherTeam]) => {
                      if (teamId === myTeamId) return;
                      for (let r = 1; r <= selectedRoundTab; r++) {
                        const rData = otherTeam.rounds[r];
                        if (rData && rData.peerFeedbacks) {
                          rData.peerFeedbacks.forEach((item) => {
                            const matchesAuthor = item.authorId === myTeamId || item.text.trim().startsWith(`${myTeamId} ㅣ`) || item.text.trim().startsWith(`${myTeamId.replace("조", "")}조 ㅣ`);
                            if (matchesAuthor) {
                              mySentFeedbacks.push({ targetTeamId: teamId, item, _originRound: r });
                            }
                          });
                        }
                      }
                    });

                    if (mySentFeedbacks.length === 0) {
                      return (
                        <p className="text-[11px] text-neutral-400 italic text-center py-4 bg-white border border-neutral-200">
                          타 조에 제시한 피드백이 없습니다. 메인 보드에서 타 조의 안건에 피드백을 기록해 보십시오.
                        </p>
                      );
                    }

                    return mySentFeedbacks.map(({ targetTeamId, item, _originRound }) => {
                      const isItemApplied = !!item.isApplied;
                      const isItemDeleted = !!item.isDeleted;
                      const cleanText = item.text.substring(item.text.indexOf("ㅣ") + 1).trim();

                      return (
                        <div
                          key={item.id}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 border transition-all ${
                            isItemApplied
                              ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                              : isItemDeleted
                              ? "bg-neutral-50 border-neutral-200 text-neutral-400 opacity-60 line-through decoration-neutral-400"
                              : "bg-white border-neutral-200 text-neutral-800"
                          }`}
                        >
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-block px-1.5 py-0.5 text-[9px] font-sans font-extrabold bg-neutral-800 text-white rounded-sm">
                                TO: {targetTeamId}
                              </span>
                              <span className="inline-block px-1 py-0.5 text-[8px] font-mono font-bold bg-neutral-200 text-neutral-700 rounded-sm">
                                ROUND {_originRound || selectedRoundTab}
                              </span>
                            </div>
                            <p className="text-xs leading-normal font-medium">
                              {cleanText}
                            </p>
                          </div>

                          <div className="flex gap-1 shrink-0 self-end sm:self-center">
                            <button
                              onClick={() => handleToggleSentFeedbackStatus(targetTeamId, item.id, "apply")}
                              className={`px-2 py-1 text-[10px] font-bold border transition-colors cursor-pointer rounded-sm ${
                                isItemApplied
                                  ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                                  : "bg-white text-emerald-700 border-neutral-300 hover:bg-neutral-50"
                              }`}
                            >
                              {isItemApplied ? "✓ 적용됨" : "적용"}
                            </button>
                            <button
                              onClick={() => handleToggleSentFeedbackStatus(targetTeamId, item.id, "delete")}
                              className={`px-2 py-1 text-[10px] font-bold border transition-colors cursor-pointer rounded-sm ${
                                isItemDeleted
                                  ? "bg-red-650 text-white border-red-650 hover:bg-red-700"
                                  : "bg-white text-red-700 border-neutral-300 hover:bg-neutral-50"
                              }`}
                            >
                              {isItemDeleted ? "✓ 제외됨" : "삭제"}
                            </button>
                            <button
                              onClick={() => handleDeleteSentFeedback(targetTeamId, item.id)}
                              className="text-xs text-neutral-400 hover:text-black font-mono font-bold px-1"
                              title="아예 삭제"
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}



            {/* Input component for other groups/facilitator to leave peer feedback */}
            {isReadOnly && (
              <div className="bg-white p-3 border border-neutral-300 space-y-2 mt-2">
                <p className="text-[11px] font-black text-black">✍️ 이 조 해결안에 대해 다각도 크리틱 및 제안 남기기 (타 조 전용)</p>
                <div className="flex flex-col gap-1.5 pt-0.5">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newFeedbackText}
                      onChange={(e) => setNewFeedbackText(e.target.value)}
                      placeholder="구체적 비판 의견 혹은 개선 제안을 입력하십시오..."
                      className="flex-1 p-1.5 border border-black text-xs"
                    />
                    <button
                      onClick={handleAddPeerFeedback}
                      className="px-3.5 bg-black text-white text-xs font-bold font-mono hover:bg-neutral-800"
                    >
                      등록
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
