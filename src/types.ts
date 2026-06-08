export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  isApplied?: boolean;
  isDeleted?: boolean;
  authorId?: string;
}

export interface RoundData {
  roundNumber: number; // 1, 2, 3, 4
  agendaTitle: string;
  agendaSummary: string;
  feasibilityFeedback: string;
  efficiencyFeedback: string;
  cultureFeedback: string;
  improvementDirection: string;
  nextQuestion: string;
  completionScore: number; // slider scale 0-100 indicating proposal completion
  
  // Evaluation of items assigned from PREVIOUS round's feedback
  appliedChecklist: ChecklistItem[];
  
  // Received peer feedbacks list with checked statuses for the current round
  peerFeedbacks?: ChecklistItem[];
}

export interface TeamData {
  teamId: string; // "1조", "2조", "3조", "4조", "5조"
  isCompleted: boolean;
  rounds: { [roundNumber: number]: RoundData };
}

export interface HackathonState {
  currentRound: number; // 1 to 4
  isFeedbackMode: boolean; // false -> discussion (30m), true -> feedback/peer review (5m)
  timerSeconds: number; // custom countdown timer
  isTimerRunning: boolean;
  selectedTeamTab: string; // "1조" ~ "5조" OR "all" (Facilitator Central Board)
  teams: { [teamId: string]: TeamData };
}
