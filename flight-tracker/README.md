# ✈︎ 항공권 가격 추적기

Google 항공권 가격을 매일 자동으로 조회해서 기록하고, 가격 추이 그래프를 보여주고, 목표가 이하로 떨어지면 메일을 보냅니다.
GitHub 하나로 모든 것이 돌아갑니다 (서버·DB 불필요, 무료).

```
매일 오전 9시 (GitHub Actions)
  └─ SerpApi 로 Google 항공권 검색 → 출발 시간대 안 최저가 선택
  └─ site/data/ 에 날짜별 기록 저장 (저장소에 자동 commit)
  └─ 목표가 이하 → Gmail 로 알림 메일
  └─ GitHub Pages 로 그래프 웹페이지 배포
```

## 처음 설정 (한 번만, 약 10분)

### 1. SerpApi 키 발급
1. https://serpapi.com 가입 (무료 플랜: 월 250회, 가입 시 휴대폰 인증 필요)
2. 대시보드의 **API Key** 복사

> 노선 1개 = 하루 1회 조회. 편도는 검색 1회, 왕복은 가는 편 + 오는 편으로 검색 2회를 씁니다. 무료 플랜(월 250회)이면 왕복 노선 4개 정도까지 추적할 수 있어요.
>
> 추적 페이지 맨 위에 **SerpApi 남은 검색 수, 다음 갱신일, 갱신일까지 예상 사용량**이 보여요. 가격 조회 때마다 SerpApi Account API(검색 횟수에 포함되지 않음)로 함께 확인합니다. API 키와 계정 이메일은 저장하지 않아요.

### 2. Gmail 앱 비밀번호 발급
1. Google 계정 → 보안 → **2단계 인증** 켜기 (필수)
2. https://myaccount.google.com/apppasswords 에서 앱 이름(예: flight) 입력 → 16자리 비밀번호 복사

### 3. GitHub 저장소에 비밀값 등록
저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `SERPAPI_KEY` | SerpApi API 키 |
| `GMAIL_USER` | 보내는 Gmail 주소 |
| `GMAIL_APP_PASSWORD` | 16자리 앱 비밀번호 (공백 없이) |
| `ALERT_EMAIL` | 알림 받을 주소 (생략하면 `GMAIL_USER` 로 받음) |

### 4. GitHub Pages 켜기
저장소 → **Settings → Pages → Source: GitHub Actions** 선택

### 5. main 브랜치에 합치기
GitHub 예약 실행은 **기본 브랜치(main)에서만** 돌아갑니다. 이 작업 브랜치를 main 에 merge 하세요.

### 6. 첫 실행
**Actions 탭 → 항공권 가격 체크 → Run workflow**. 끝나면 `https://<아이디>.github.io/<저장소이름>/` 에서 확인할 수 있어요.

## 노선 추가 / 수정

`flight-tracker/routes.json` 을 GitHub 에서 직접 수정하면 됩니다. 웹페이지의 **+ 노선 추가하기** 화면에서 입력하면 붙여 넣을 내용을 만들어 줘요.

```jsonc
{
  "id": "icn-nrt-20261220",     // 고유 이름 (영문·숫자·하이픈)
  "name": "서울 → 도쿄",
  "from": "ICN", "to": "NRT",   // 공항 코드 (김포 GMP, 김해 PUS, 오사카 KIX, 후쿠오카 FUK …)
  "date": "2026-12-20",          // 가는 날
  "return_date": null,           // 왕복이면 "2026-12-24" (가격은 왕복 총액)
  "depart_after": "09:00",       // 이 시각부터
  "depart_before": "12:00",      // 이 시각까지 출발하는 편 중 최저가
  "adults": 1,
  "travel_class": "economy",     // economy / premium_economy / business / first
  "max_stops": null,             // null = 상관없음, 0 = 직항만, 1 = 1회 경유 이하
  "alert_below": 250000,         // 이 가격(원) 이하면 메일
  "active": true                 // false 로 바꾸면 일시 중지
}
```

routes.json 을 저장(commit)하면 바로 한 번 실행되어 첫 가격이 기록됩니다.

## 동작 규칙
- **알림 중복 방지**: 목표가 아래로 처음 내려갈 때, 또는 직전 알림보다 더 내려갔을 때만 메일을 보냅니다. 다시 목표가 위로 올라가면 초기화되어 다음 하락 때 또 알려줍니다.
- **출발일이 지나면** 자동으로 조회를 멈춥니다 (API 사용량 절약).
- **조회 실패** 시 3번 재시도하고, 그래도 실패하면 그날은 "조회 실패"로 기록되고 그래프 선이 끊겨 보입니다.
- 가격은 **한국 기준(KRW, gl=kr)** 으로 검색합니다. 저가항공은 수하물 미포함 가격일 수 있어요.

## 휴대폰 홈 화면에 앱으로 추가
추적 페이지 주소(`https://<아이디>.github.io/<저장소>/`)를 공유하면, 받은 사람도 홈 화면에 앱처럼 추가할 수 있어요.
- **iPhone (Safari)**: 공유 버튼 → "홈 화면에 추가"
- **Android (Chrome)**: 오른쪽 위 ⋮ → "홈 화면에 추가" 또는 "앱 설치"

열 때마다 최신 가격을 받아오고, 인터넷이 안 될 때는 마지막으로 본 화면을 보여줘요.

## 주의
- GitHub 무료 계정에서 Pages 를 쓰려면 저장소가 **공개(public)** 여야 합니다. 이 경우 가격 기록(`site/data`)과 노선 정보도 공개됩니다. 메일 주소·API 키는 Secrets 에만 있어 공개되지 않아요.
- GitHub 예약 실행은 몇 분~수십 분 늦게 시작될 수 있고, 저장소에 60일간 활동이 없으면 자동 중지됩니다(매일 기록 commit 이 생기므로 보통은 문제없음).

## 로컬 테스트
```bash
cd flight-tracker/tracker
python3 -m unittest -v                 # 단위 테스트
SERPAPI_KEY=... python3 check_prices.py  # 실제 조회
cd ../site && python3 -m http.server   # http://localhost:8000
```
