import { HackathonState, TeamData, RoundData } from "../types";

export const SESSION_ROUNDS_INFO = {
  1: {
    title: "1회차: 현업 아픔 정의 & 병목(Silo) 진단",
    guide: "본부 간 상호작용에서 발생하는 최악의 병목 현상과 고통(Pain point)을 정의하고, 문제의 핵심 근본 원인을 해부하십시오. 현 상황을 가밈없이 진술하십시오.",
  },
  2: {
    title: "2회차: 실행 가능 혁신 아이디어 및 R&R 초안",
    guide: "1회차에서 제기된 병목을 돌파할 기발하고 효과적인 업무 효율화 아이디어를 제안하십시오. 주관 부서와 유관 부서의 구체적인 책임(R&R) 초안을 그리십시오.",
  },
  3: {
    title: "3회차: 실행 난제 정의 및 비판적 정교화",
    guide: "유관 부서들이 지적한 비판적 피드백을 수용하여, 예견되는 저항, 규제, IT 연동 제약 등의 현실적인 극복 장벽과 액션 플랜을 더 심화 정의하여 다듬으십시오.",
  },
  4: {
    title: "4회차: 최종 이행 로드맵 및 기대 효과 정량화",
    guide: "어떻게 현업에 전면 확산할 것인지 타임라인을 그리고, 월별 예상 단축 공수(M/D)와 가치 상승 효과를 구체적인 통계와 숫자로 입증하며 최종 발표안을 고도화하십시오.",
  },
};

export const INITIAL_PRESETS: { [teamId: string]: Partial<RoundData> } = {
  "1조": {
    agendaTitle: "",
    agendaSummary: "",
    feasibilityFeedback: "",
    efficiencyFeedback: "",
    cultureFeedback: "",
    improvementDirection: "",
    nextQuestion: "",
    completionScore: 0,
  },
  "2조": {
    agendaTitle: "",
    agendaSummary: "",
    feasibilityFeedback: "",
    efficiencyFeedback: "",
    cultureFeedback: "",
    improvementDirection: "",
    nextQuestion: "",
    completionScore: 0,
  },
  "3조": {
    agendaTitle: "",
    agendaSummary: "",
    feasibilityFeedback: "",
    efficiencyFeedback: "",
    cultureFeedback: "",
    improvementDirection: "",
    nextQuestion: "",
    completionScore: 0,
  },
  "4조": {
    agendaTitle: "",
    agendaSummary: "",
    feasibilityFeedback: "",
    efficiencyFeedback: "",
    cultureFeedback: "",
    improvementDirection: "",
    nextQuestion: "",
    completionScore: 0,
  },
  "5조": {
    agendaTitle: "",
    agendaSummary: "",
    feasibilityFeedback: "",
    efficiencyFeedback: "",
    cultureFeedback: "",
    improvementDirection: "",
    nextQuestion: "",
    completionScore: 0,
  },
};

export function createInitialState(usePresets: boolean = false): HackathonState {
  const teams: { [teamId: string]: TeamData } = {};
  const teamIds = ["1조", "2조", "3조", "4조", "5조"];

  for (const id of teamIds) {
    const rounds: { [roundNumber: number]: RoundData } = {};
    for (let r = 1; r <= 4; r++) {
      // Create empty rounds content
      rounds[r] = {
        roundNumber: r,
        agendaTitle: "",
        agendaSummary: "",
        feasibilityFeedback: "",
        efficiencyFeedback: "",
        cultureFeedback: "",
        improvementDirection: "",
        nextQuestion: "",
        completionScore: 0,
        appliedChecklist: [],
        peerFeedbacks: [
          {
            id: `init_p1_${id}_${r}`,
            text: `2조 ㅣ 타 본부 실무 담당자들의 구체적인 R&R 분장과 리드 타임이 합의되어야 실제 적용 가능해 보입니다.`,
            checked: false,
          },
          {
            id: `init_p2_${id}_${r}`,
            text: `3조 ㅣ 전사적 전용 IT 서버를 신축하기보다는 슬랙 채널 및 노션 데이터베이스 연동 등으로 사전 가성비 효과성 검증을 추천합니다.`,
            checked: false,
          },
          {
            id: `init_p3_${id}_${r}`,
            text: `4조 ㅣ 강제적인 신규 일관 결재 프로세스나 페널티 부여는 부서원들의 수동적 거부 반응과 행정 피로도를 낳을 위험이 큽니다.`,
            checked: false,
          },
        ]
      };
    }

    // Load custom presets to Round 1 if requested
    if (usePresets && INITIAL_PRESETS[id]) {
      const preset = INITIAL_PRESETS[id];
      rounds[1] = {
        roundNumber: 1,
        agendaTitle: preset.agendaTitle || "",
        agendaSummary: preset.agendaSummary || "",
        feasibilityFeedback: preset.feasibilityFeedback || "",
        efficiencyFeedback: preset.efficiencyFeedback || "",
        cultureFeedback: preset.cultureFeedback || "",
        improvementDirection: preset.improvementDirection || "",
        nextQuestion: preset.nextQuestion || "",
        completionScore: preset.completionScore || 0,
        appliedChecklist: [],
        peerFeedbacks: [
          {
            id: `init_preset1_${id}`,
            text: `2조 ㅣ 타 본부 실무 담당자들의 구체적인 R&R 분장과 리드 타임이 합의되어야 실제 적용 가능해 보입니다.`,
            checked: false,
          },
          {
            id: `init_preset2_${id}`,
            text: `3조 ㅣ 전사적 전용 IT 서버를 신축하기보다는 슬랙 채널 및 노션 데이터베이스 연동 등으로 사전 가성비 효과성 검증을 추천합니다.`,
            checked: false,
          },
          {
            id: `init_preset3_${id}`,
            text: `4조 ㅣ 강제적인 신규 일관 결재 프로세스나 페널티 부여는 부서원들의 수동적 거부 반응과 행정 피로도를 낳을 위험이 큽니다.`,
            checked: false,
          },
        ]
      };
    }

    teams[id] = {
      teamId: id,
      isCompleted: false,
      rounds: rounds,
    };
  }

  return {
    currentRound: 1,
    isFeedbackMode: false,
    timerSeconds: 1800, // 30 minutes in seconds
    isTimerRunning: false,
    selectedTeamTab: "all", // "all" for Facilitator Board
    teams: teams,
  };
}

export function saveStateToStorage(state: HackathonState) {
  try {
    localStorage.setItem("hackathon_workshop_state_clean", JSON.stringify(state));
  } catch (e) {
    console.error("State saving to LocalStorage failed", e);
  }
}

export function loadStateFromStorage(): HackathonState | null {
  try {
    const raw = localStorage.getItem("hackathon_workshop_state_clean");
    if (raw) {
      return JSON.parse(raw) as HackathonState;
    }
  } catch (e) {
    console.error("State loading from LocalStorage failed", e);
  }
  return null;
}
