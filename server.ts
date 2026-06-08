import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Lazy initialization of Gemini API
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
      aiClient = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Global Sync State for multi-user Follow-Along mode
  let syncState = {
    activeTeamId: "all",
    currentRound: 1,
    isFeedbackMode: false,
    isTimerRunning: false,
    timerSeconds: 1800,
    isBroadcasting: true,
    isProjectorLive: false,
    lastUpdated: Date.now(),
  };

  // Sync State HTTP Handlers
  app.get("/api/sync-state", (req: express.Request, res: express.Response) => {
    res.json(syncState);
  });

  app.post("/api/sync-state", (req: express.Request, res: express.Response) => {
    syncState = {
      ...syncState,
      ...req.body,
      lastUpdated: Date.now(),
    };
    res.json(syncState);
  });

  // API Routes
  app.post("/api/ai-facilitator", async (req: express.Request, res: express.Response) => {
    try {
      const {
        teamId,
        currentRound,
        agendaTitle,
        agendaSummary,
        feasibilityFeedback,
        efficiencyFeedback,
        cultureFeedback,
        previousFeedback,
      } = req.body;

      const ai = getGeminiClient();

      if (!ai) {
        // Fallback to high-quality procedural Korean corporate facilitator messages if API key is not available
        console.warn("GEMINI_API_KEY is not configured or placeholder. Using high-quality procedural generator.");
        const fallbackResponse = generateProceduralFeedback(teamId, currentRound, agendaTitle, agendaSummary);
        res.json(fallbackResponse);
        return;
      }

      const prompt = `당신은 대한민국 최고 수준의 '본부간 업무효율화 해커톤'을 이끄는 전문 퍼실리테이터이자 조직 혁신 컨설턴트입니다.
현재 ${teamId}조의 ${currentRound}회차 논의 안건에 대해 냉철하고 현실적이며 성장을 자극하는 피드백을 제공해야 합니다.

[조 안건 정보]
- 조: ${teamId}조
- 안건명: ${agendaTitle || "미지정"}
- 현재 안건 요약: ${agendaSummary || "아직 작성되지 않음"}

[축적된 이전 피드백/의견]
- 실행 가능성 피드백: ${feasibilityFeedback || "없음"}
- 비용/시간 효율성 피드백: ${efficiencyFeedback || "없음"}
- 조직문화 정합성 피드백: ${cultureFeedback || "없음"}
- 이전 회차 피드백: ${previousFeedback || "없음"}

[피드백 작성 지침]
1. 세 가지 자문 관점에서 전문적이고 구체적인 검토 의견을 주세요.
   - 실행 가능성 (feasibility): 본부간 의견 대립 해소 방안, 주관 부서 및 책임(R&R) 소재 명확성, 실무 수준의 권한 부여 한계 지적.
   - 비용/시간 효율성 (efficiency): 투입되는 공수(M/D) 대비 기대 효과의 크기, 초기 구축 비용 가성비, 장기적 유지보수 공수 분석.
   - 조직문화 정합성 (culture): 단순 '규제'나 '통제'가 되어 직원 피로도를 늘리지 않는지, 수평적이고 자율적인 협업을 이끄는지 여부.
2. 이전 피드백을 팀이 어떻게 통합하여 한 단계 발전시킬 수 있는지 '개선 방향성 (improvement)'을 2~3줄로 도출하세요.
3. 다음 ${currentRound >= 4 ? "최종 발표" : `${currentRound + 1}회차 토론`}을 고도화하기 위한 날카롭고 도발적인 질문 1개를 'nextQuestion'으로 만드세요.
4. 모든 문장은 격조 높은 공문서 보고서 톤앤매너(~함, ~임, ~요망, ~필요) 또는 매우 격식 있는 퍼실리테이터 존댓말(~하십시오, ~것을 제안합니다)로 작성하십시오.

반드시 JSON 객체형식으로 정확히 응답해주십시오. 스키마:
{
  "feasibility": "실행 가능성 분석 내용",
  "efficiency": "비용/시간 효율성 분석 내용",
  "culture": "조직문화 정합성 분석 내용",
  "improvement": "안건 개선 방향성 및 고도화 전략",
  "nextQuestion": "이 안건이 생존하기 위해 다음 세션에서 반드시 답해야 하는 난제 질문"
}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              feasibility: { type: Type.STRING },
              efficiency: { type: Type.STRING },
              culture: { type: Type.STRING },
              improvement: { type: Type.STRING },
              nextQuestion: { type: Type.STRING },
            },
            required: ["feasibility", "efficiency", "culture", "improvement", "nextQuestion"],
          },
        },
      });

      const responseText = response.text || "{}";
      const parsedData = JSON.parse(responseText.trim());
      res.json(parsedData);
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({
        error: "AI 피드백 생성 중 오류가 발생했습니다. 로컬 피드백을 제공합니다.",
        feasibility: "실행 부서 간의 책임 소관(R&R) 정립이 급선무입니다. 본사 지원 조직과 실무부서 간 가이드라인을 상세 정의할 것을 권고합니다.",
        efficiency: "초기 시스템 도입 및 교육 비용 대비 일일 단축 공수의 누적 가치가 더 높은지 비용대비효과 분석(ROI)이 세부적으로 기술되어야 합니다.",
        culture: "제도 강화가 부서간 협무 요청 부담을 전가하는 '또 다른 사일로 장벽'을 생성할 가능성이 있습니다. 상호 신뢰 기반의 프로토콜 설계가 요망됩니다.",
        improvement: "본 안건의 완성도를 높이기 위해서는 각 단계별 정량적 마일스톤 및 예외 상황 대응 시나리오 보완 필요.",
        nextQuestion: "해당 안건의 제안 사항을 타 부서에서 기꺼이 수용하게 만들기 위한 강력한 '당근'(인센티브 혹은 거부할 수 없는 장점)은 무엇인가?"
      });
    }
  });

  // Serve static visual assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

// Helper to provide high quality procedural feedback for hackathons in offline mode
function generateProceduralFeedback(teamId: string, round: number, title?: string, summary?: string) {
  const normTitle = title || "미정 안건";
  const desc = summary || "";

  // Dynamic content based on keywords
  let feasibility = "핵심 주관부서의 역할 배분(R&R) 정비가 누락되어 실제 실무 협업 시 추진력이 약화될 우려가 있음. 관련 유관부서 실무진과의 공식 합의체 협약을 시나리오에 구체적으로 명시할 필요가 있음.";
  let efficiency = "수동적인 수작업 프로세스를 일부 표준화하는 수준에 그쳐 중장기적 비용 단축 시너지가 불분명함. 정량적인 예상 단축 시간(M/D) 및 인적 자원 세이브 효과를 숫자로 명확히 제시하는 과정이 요구됨.";
  let culture = "제도적 강제 규정이 자칫 유관 부서원들에게 과도한 승인 절차나 서류작업 피로감을 안겨 주어 소통 장벽을 가중시킬 위험이 잔존함. 자발적인 참여를 자극하는 '협업 인센티브제' 연계가 권장됨.";
  let improvement = "단순 효율적 도구 도입에 안주하지 말고, 부서 간 업무 이관(Hand-off) 시점의 불필요한 직결 보고체계를 간소화하고, 정보 비대칭을 상시 해결하는 자동 공유 채널 개설 방향으로 고도화해야 함.";
  let nextQuestion = `해당 혁신안을 실제로 내일 아침 현업에 즉시 적용한다면, 가장 격렬하게 반대할 '핵심 반대론자'(특정 본부 혹은 역할군)는 누구이며, 그들을 어떤 설득 논리로 우군으로 포섭할 것인가?`;

  if (desc.includes("회의") || normTitle.includes("회의") || desc.includes("보고") || normTitle.includes("보고")) {
    feasibility = "임원진 및 부서장급의 회의 성향 및 결재 승인 전결 규정의 수정이 선행되어야 함. 전결 규정 간소화 가이드가 실무 정책으로 성안되지 않으면 공염불이 될 잠재적 위험이 큼.";
    efficiency = "회의 횟수 통제로 주당 약 4시간의 공수 단축은 기대되나, 비대면 소통 전환에 따른 오해 비용 및 사후 트래블슈팅 리스크가 세밀히 반영되지 않아 중장기 설계 비용 증가 우려가 있음.";
    culture = "회의 자체를 금기시하는 문화가 오히려 캐주얼한 소통조차 말살하는 부작용이 우려됨. 회의 방식의 변화와 함께 '메신저 허들'이나 '상시 공유 스프린트 보드'의 슬림한 대체 활동 정착이 필수 지점임.";
    improvement = "보고 자료 서식 자체의 비주얼 정리를 금지하고 텍스트 위주의 'Single-page Bullet report'로 통일함으로써 보고서 작성에 들이는 불필요한 부가가치 파괴 활동을 완전히 거세하는 강력한 룰 정립 필요.";
  } else if (desc.includes("시스템") || normTitle.includes("시스템") || desc.includes("자동") || normTitle.includes("툴") || desc.includes("앱") || normTitle.includes("플랫폼")) {
    feasibility = "IT 지원 인력 및 보안성 심의(개인정보 가이드라인 및 내부 자산 유출 방지 등) 허들이 명확함. 현업 시스템에 대한 데이터 연동 API의 가용한 개발 범위가 명시되었는지 우선 점검 요구됨.";
    efficiency = "자체 커스텀 툴 개발 비용 대비 아웃소싱 또는 SaaS 도구(예: Slack, Notion 등) 활용과의 TCO(총 소유비용) 비교가 서술되어 비용 정당성을 확보해야 설득력을 얻을 수 있음.";
    culture = "신규 디지털 툴 적응에 극심한 거부감을 보일 고연령대 혹은 현장 실무 인력을 위한 맞춤형 온보딩 프로그램이 누락되면 하향식 강제화에 따른 생산성 저하 우려가 대두됨.";
    improvement = "인프라 구축 그 자체를 솔루션으로 삼지 말고, 기존에 쓰던 사내 인트라넷 게시판의 단순 UX 개편과 표준 서식 트리거 정립 등 '가성비 있고 빠른 우회 적용책'을 이중 설계할 것.";
  }

  return {
    feasibility,
    efficiency,
    culture,
    improvement,
    nextQuestion,
  };
}

startServer();
