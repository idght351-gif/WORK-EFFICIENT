# 마일 좌석 조회 절차서

> **상태: 일부 가르침 (2026-11-24)** — 남은 ❓: 직항 필터 위치(직항만 노선이 생기면), 예외 표 일부. ❓ 가 남아 있는 단계는 혼자 진행하지 말고 사용자에게 물어요.

집 PC의 Claude 가 **조회할 때마다 처음부터 끝까지 읽고 그대로 따르는** 문서예요.
에어프랑스 Flying Blue "마일리지로 예약" 화면에서, 노선마다 날짜별 최저 마일(캘린더)을 읽고, 목표 마일 이하인 날짜만 편 상세까지 열어 세금 · 유류할증료를 확인해요.
도구: **Claude in Chrome** (사용자 크롬, 로그인 그대로) + `python award-tracker/tools/award.py` (결과 저장). Windows 에서 `python` 이 안 되면 `py` 로 실행해요.

---

## 0. 항상 지키는 것

**천천히 (사용자 요청)**
- 클릭 · 입력 · 선택 하나마다 → `python award-tracker/tools/award.py wait click` (8~15초)
- 검색 버튼 · 날짜 선택처럼 결과를 불러오는 클릭 뒤 → `wait search` (20~35초)
- 검색 하나를 끝내고 다음 검색 전 → `wait between` (40~80초)
- 화면이 이미 바뀌었어도 기다림을 줄이지 않아요. 기다린 뒤 화면을 보고 다음 단계로 가요.
- 기다리는 범위는 `routes.json` 의 `settings.wait_seconds` 에서 바꿔요 (2026-11-25 부터 click 10~20 · search 30~45 · between 90~150초).

**무리하지 않기 (2026-11-24 접속 차단 뒤 정한 기준)**
- 한 번 조회에 캘린더 **8개월치**(`max_searches_per_run: 8`), 상세 확인은 노선당 **3일**(`max_details_per_route: 3`)까지만. 남은 달 · 날짜는 다음 조회 때 오래된 것부터 이어서 해요.
- 조회는 **하루 1번** 정도로. 조회를 끝낸 뒤 적어도 몇 시간은 다시 하지 않아요 (사용자가 원하면 예외).
- 새로고침 · 홈 다시 열기를 연달아 하지 않아요. 다시 시도는 **한 번만**, 그 전에 몇 분 쉬어요.
- **크롬 오류 페이지("error page"), 접속이 안 됨, 갑자기 로그아웃** 은 차단 신호로 봐요 → 다시 시도하지 말고 바로 `finish challenge --message "…"` → 4장.

**읽는 법**
- 마일 · 세금 숫자는 **페이지 글자**(get_page_text / read_page)로 읽어요. 스크린샷은 위치와 화면 상태 확인용이에요.
- 버튼은 좌표가 아니라 **화면에 적힌 이름**으로 찾아요(find). 이름이 같은 게 여러 개면 위치 설명(“검색창 오른쪽”)으로 구분해요.

**하지 않는 것**
- 아이디 · 비밀번호 입력, 보안 확인(캡차) 풀기
- 예약 · 결제 · 마일 사용 · 개인정보 변경 버튼 누르기 (편 선택 후 "계속" 다음이 결제 단계면 거기서 멈춰요)
- 에어프랑스 밖으로 이동, 처음 보는 주소 열기
- 탭 여러 개로 동시에 검색하기 (항상 탭 하나)

**멈추는 때**
| 상황 | 할 일 |
|---|---|
| 보안 확인(캡차) · "로봇이 아닙니다" · 접근 차단 화면 | 바로 멈춤 → `finish challenge --message "무엇을 봤는지"` → 4장으로 |
| 로그인 화면이 나오거나 로그아웃됨 | 사람이 보고 있으면 로그인을 부탁하고 기다림. 아니면 `finish login_required` → 4장으로 |
| 같은 단계를 2번 해도 안 됨, 절차서와 다른 화면 | 사람이 보고 있으면 화면을 설명하고 물어봄. 아니면 `finish error --message "어느 단계에서 무엇이"` → 4장으로 |
| 브라우저 알림창(확인/취소 창)이 뜰 것 같은 버튼 | 누르지 않음 |

**Claude in Chrome 쓰는 법**
- 시작할 때 `tabs_context_mcp` 로 탭 상태를 보고, **새 탭**(`tabs_create_mcp`)에서 작업해요. 끝나면 만든 탭을 닫아요.
- 도구가 응답하지 않으면 2번까지만 다시 해 보고, 안 되면 멈추고 알려요 (`/chrome` → Reconnect).

---

## 1. 시작

1. `git pull --autostash` (사용자가 휴대폰으로 바꾼 노선 · 이 절차서를 받음)
2. `python award-tracker/tools/award.py start` → 이번에 검색할 목록이 나와요. 목록이 비어 있으면 4장으로.
3. Claude in Chrome: `tabs_context_mcp` → 새 탭 → 에어프랑스 열기
   - 주소: `https://wwws.airfrance.co.kr/en` (영어 화면, `settings.airfrance_url` 과 같음)
   - `wait search`
4. 쿠키 · 알림 배너가 있으면: 쿠키 배너가 뜨면 **모두 승인 스위치를 켜고 닫아요** (사용자 지시, 6장 참고. 2026-11-24 에는 이미 승인돼 있어 안 뜸). 위쪽 "Situation in the Near and Middle East" 안내 띠는 **닫지 않아도 돼요**.
5. 로그인 확인: 오른쪽 위에 이름 "SANGSOO SHIM" + 등급 배지 "EXPLORER", 검색 칸 스위치 글자에 보유 마일("Book with my 992 Miles")이 보이면 로그인된 상태

## 2. 캘린더 검색 — 목록의 항목마다

항목 예: `3. TYO→SEL 이코노미 2027-02 직항·경유 모두 [sel-tyo-20270201 · 오는 편 · 기간 2027-02-01~2027-02-28]`

- **도시 코드로 검색**: SEL(서울: 인천·김포), TYO(도쿄: 나리타·하네다), OSA(오사카·고베: 간사이·이타미·고베). 출발지 · 도착지 칸에 코드를 넣으면 목록에 도시 항목(예: "Seoul, Korea, Republic of / All airports  SEL")과 그 아래 ↳ 공항(GMP, ICN)이 나와요. **공항이 아니라 도시 코드 항목(All airports)을 골라요.** "Popular destinations" 와 "All destinations" 양쪽에 같은 도시 항목이 있으면 "All destinations" 쪽을 골라요.
- **직항 · 경유 모두**: 항목에 "직항·경유 모두"라고 나오면 직항 필터를 켜지 않아요. "직항만"이면 직항 필터를 켜요 ❓ (필터 위치)
- 목표 마일이 없는 노선은 `save` 가 그 달에서 마일이 가장 적은 날을 상세 확인 날짜로 추천해요.

> **홈 화면은 지난 검색값을 기억해요.** 다시 들어오면 마일 스위치가 이미 켜져 있고 One-way · From · To 도 남아 있을 수 있어요. **스위치가 이미 켜져 있으면 누르지 않아요**(누르면 꺼짐). 2-1~2-6 은 화면 값이 항목과 다를 때만 바꿔요.

| # | 이 화면인지 확인하는 단서 | 할 일 (버튼 이름 · 위치) | 기다림 | 됐는지 확인 |
|---|---|---|---|---|
| 2-1 | 첫 화면을 조금 내리면 흰 검색 칸("Round trip" · "Economy" · From · To · Travel dates · Passengers · "Search flights")이 보임 | **가장 먼저** 검색 칸 왼쪽 아래 스위치 **"Book with my ○○○ Miles"** 켜기 (find 로 switch "Book with my" 찾아 scroll_to 후 클릭) | click | 스위치가 짙은 파랑으로 바뀌고 동그라미가 오른쪽으로 감 |
| 2-2 | 스위치가 켜진 검색 칸, 왼쪽 위 드롭다운에 "Round trip" | "Round trip" 드롭다운(combobox "Trip") 누르기 → click → 열린 목록("Round trip" / "One-way")에서 **"One-way"** 누르기 | click (여는 것 · 고르는 것 각각) | 드롭다운 글자가 "One-way", 날짜 칸 이름이 "Travel dates" → "Departure date" 로 바뀜 |
| 2-3 | "One-way" 로 바뀐 검색 칸, 맨 왼쪽 빈 칸 "From" | "From" 칸 누르기 → click → 출발 코드(예: `SEL`) 입력 → click → 목록 "All destinations" 아래 도시 항목("Seoul, Korea, Republic of / All airports  SEL", ↳ GMP · ICN 위에 있는 것) 누르기 (find 의 option "From Seoul, Korea…") | click (누른 뒤 · 입력 후 · 선택 후 각각) | 목록이 닫히고 From 칸에 "Seoul  SEL" |
| 2-4 | From 칸에 "Seoul  SEL", 그 오른쪽(⇄ 버튼 옆) 빈 칸 "To" | "To" 칸 누르기 → click → 도착 코드(예: `TYO`) 입력 → click → 목록 맨 위 도시 항목("Tokyo, Japan / All airports  TYO", ↳ Haneda HND · Narita Airport NRT 위에 있는 것) 누르기 (find 의 option "To Tokyo, Japan…"). 이때는 "Popular/All destinations" 구분 없이 도시 항목 하나만 나옴 | click (각각) | 목록이 닫히고 To 칸에 "Tokyo  TYO" |
| 2-5 | From · To 가 채워진 검색 칸 | **"Departure date" 칸은 누르지 않고 비워 둠** (비운 채 검색하면 캘린더가 나옴) | — | 날짜 칸 글자가 그대로 "Departure date" |
| 2-6 | 검색 칸 "Passengers 1 adult", 등급 드롭다운("One-way" 오른쪽) | 인원은 기본 "1 adult" 그대로. 등급은 **"Economy" 그대로 둠**. 비즈니스 검색은 하지 않아요 (2026-11-24 사용자: 등급 바꾸기는 진행하지 않음) — 비즈니스는 3-4b 처럼 상세 화면에서 읽어요 | — | "1 adult" · "Economy" |
| 2-7 | 검색 칸이 다 채워짐 (날짜만 빈 칸) | 검색 칸 오른쪽 아래 파란 버튼 **"Search flights"** | **search** | 주소가 `…/search/open-dates/0`, 탭 제목 "Departure date selection", 글자 "Departure date / From Seoul to Tokyo, Economy" 와 달 띠(October · November · December · January …, 달마다 "8,500 Miles" 같은 그 달 최저 마일) + 달력. 처음엔 이번 달 또는 다음 가능한 달이 열려 있음 |
| 2-8 | 캘린더 화면, 달력 위 달 띠 (‹ October · November · December · January · February … ›) | 달 띠에서 **항목의 달 칸을 직접 누름** (예: "February", find 의 button "Display fares for February"). 띠에 그 달이 안 보이면 오른쪽 "›"("Display fares for next month")로 넘김 | search | 달력 제목이 "2027 February", 그 달 칸이 빨간 밑줄 + "from" 표시 |
| 2-9 | 달력 제목 "2027 February" | get_page_text 로 읽기: (달 띠의 "from …" 값은 실제 최저와 다를 수 있으니 날짜 칸 값만 써요 — TYO→SEL 2월은 띠 9,500 인데 날짜엔 8,500 있음. 달력 앞뒤에 다른 달 날짜(예: 26~31 Oct)가 회색으로 붙으면 빼요) "2027 February / Mo Tu We Th Fr Sa Su" 아래로 날짜 숫자가 줄마다 나오고, 좌석이 있으면 바로 다음 줄에 "8,500 Miles". **숫자 뒤에 Miles 줄이 없으면 좌석 없음(`null`)**. 화면에서도 좌석 없는 날은 숫자만 있음. 확인용으로 find 의 날짜 버튼 이름("15 Feb 2027 Lowest fare is 8,500 Miles", 좌석 없음은 "3 Feb 2027" 만)도 같음. 초록 글자 날 = 그 달 최저 | — | 날짜 수가 그 달 일수와 같음 (2월 28일). 달력 끝 "Lowest fare" 이후 글자는 무시 |
| 2-10 | — | 읽은 값을 5장 형식으로 `save` | — | "✓ 저장" 확인 |

- **다음 검색 (3-5 "← Back" 으로 검색 칸에 돌아온 뒤)**: 처음 주소로 다시 가지 않아요. 검색 칸에서 바꿀 것만 바꿔요.
  - 방향만 반대면(예: SEL→TYO 다음 TYO→SEL): From · To 사이 **⇄ 버튼**("Swap departure and arrival airports") 누르기 → click → From "Tokyo TYO" · To "Seoul SEL" 확인. 다른 도시면 2-3 · 2-4 처럼 다시 입력.
  - **날짜 비우기**: "Departure date" 칸(예: "Feb 15") 누르기 → click → 달력 창 오른쪽 아래 **"Clear dates"** → click → `Escape` 키로 달력 창 닫기 ("Confirm" 은 누르지 않음) → click → 날짜 칸 글자가 "Departure date" 로 돌아옴.
  - 그다음 2-7 "Search flights" 부터.
- **어느 달을 보나**: 앱(`routes.json`)에서 노선마다 정한 **기간 안의 달만** 검색해요 (`settings.search_open_months: false`). 한 방향 기간은 최대 8개월(예: 2월~9월)이고, 넘으면 `start` 가 오류로 알려 줘요 (2026-11-24 사용자 지시).
- **같은 노선 · 같은 방향의 다음 달은 2-8 부터만**: 캘린더 화면에서 달 띠의 그 달 칸만 누르면 돼요 (다시 검색하지 않음). 이때 기다림은 `wait search` 만, `wait between` 은 방향 · 노선이 바뀌어 새로 검색할 때만 해요.
- **아직 안 열린 달**: 달 띠에서 그 달이 "-" 이고 날짜 칸이 모두 비어 있으면 **save 하지 않고** 건너뛰어요 (좌석 없음으로 기록하지 않음). 달 띠에 그 달이 안 보이면 "›" 로 넘겨 보고, 그래도 없으면 건너뛰어요.
- 상세 확인을 하러 편 목록에 들어갔다가 "← Back" 하면 검색 칸으로 가니까, **그 달의 상세 확인은 그 달 캘린더를 다 읽고 save 한 뒤에** 하고, 다음 달은 다시 검색(→ 2-7 → 2-8)해요.
- `save` 결과에 **상세 확인 추천** 날짜가 나오면 3장, 아니면 `wait between` 후 다음 항목.

## 3. 상세 확인

**어느 날짜를 여나 (2026-11-24 사용자 지시)**: 그 달 캘린더 **최저 마일 + 20% 이내** 날짜를 열어요 (예: 최저 8,500 → 10,200 이하). 노선마다 숫자를 정해 두지 않고 검색하면서 찾은 최저로 계산해요. `save` 가 이 기준(`settings.detail_within_pct`)으로 **상세 확인 추천** 날짜를 알려 주니 그 목록대로 열어요. 노선당 한 번 조회에 최대 `max_details_per_route`(3)개, 남은 건 다음 조회 때 추천돼요. 상세 하나마다 Back → 다시 검색 → 달 → 날짜로 접속이 많아지니 추천 개수를 넘기지 않아요.

| # | 이 화면인지 확인하는 단서 | 할 일 | 기다림 | 됐는지 확인 |
|---|---|---|---|---|
| 3-1 | 캘린더 화면 | 달력에서 추천 날짜 칸 누르기 (find 의 button "15 Feb 2027 Lowest fare is …") | search | 탭 제목 "Flight 1", 주소 `…/search/flights/0`, 위에 "Miles balance" · 날짜 띠, 아래 "Direct flights (n)" 편 목록 |
| 3-2 | 편 목록 화면 | get_page_text 로 편마다 읽기: 출발 시각 · 출발 공항 / "Direct" 또는 경유 · 걸리는 시간 / 도착 시각 · 도착 공항 / "Economy" 칸과 "Business" 칸의 마일. 항목 등급 칸이 **"Not available for this flight" 인 편은 빼고**, 마일이 있는 편만 적어요 ("Lowest fare" 표시 = 그날 최저). 항공사 이름(예: KOREAN AIR)은 `operated_by`. **편명은 확인하지 않아도 돼요** ("Details" 를 열지 않음, 사용자 지시) | — | 목록 위 "Direct flights (n)" 의 n 과 읽은 편 수가 같음 |
| 3-3 | 편 목록 화면 위 날짜 띠 | **더 들어가지 않아요.** 날짜 띠에서 그 날짜 칸의 "8,500 Miles / +USD 17.90" 의 USD 금액을 세금으로 씀 (사용자: 이 정도면 충분). 요금을 고르거나 "trip overview" 로 가지 않음 | — | 그 날짜 칸에 "+USD …" 가 보임 |
| 3-3b | 편 목록 화면 | **남은 좌석**: 상세를 연 날짜의 **최저가 이코노미 편**(그날 캘린더 마일과 같은 편, 예: 2/15 19:35 GMP 출발)만 봐요. 그 편 이코노미 상자에 **빨간 글씨 "N seats left"** 가 있으면 그 숫자(`"1 seats left"` → `"seats": 1`, `"2 seats left"` → `"seats": 2`), 아무것도 없으면 `"seats": "2+"`. 커서를 올려도 "Price for 1 passenger" 만 나오니 hover 는 하지 않아도 돼요 (2026-11-24 사용자 지시) | — | 앱에 "남은 좌석 1석 / 2석 / 2+석" 으로 보임 |
| 3-4b | 편 목록 화면 (같은 화면) | **비즈니스도 여기서 함께 읽어요** — 비즈니스는 따로 캘린더 검색을 하지 않아요 (`settings.search_cabins: ["economy"]`, 2026-11-24 사용자: 이코노미 최저가 날을 비즈니스 최저가 날로 보고, 그날 비즈니스 일정만 보여 주면 됨). 각 편의 "Business" 칸에 마일이 있는 편만 모아서 `"cabin": "business", "source": "detail"` 로 따로 `save`. 세금 · 남은 좌석은 비워 둠 (날짜 띠 세금은 이코노미 값) | — | "✓ 저장 … 비즈니스 … 상세" |
| 3-4 | — | 5장 형식(`source: detail`)으로 `save`. 세금은 `{"amount": 18, "currency": "USD"}` 처럼 **USD 로, 센트는 반올림**(도구가 정수만 받음). 편명 `no` 는 비워 둠 | — | "✓ 저장" |
| 3-5 | 편 목록 화면 | 왼쪽 위 **"← Back"** 누르기. **캘린더가 아니라 검색 칸 화면으로 돌아가요** | search | 주소 `…/search/advanced`, 탭 제목 "Book a flight", 검색 칸에 이전 값(One-way · 등급 · From · To · 마일 스위치 켜짐)이 남아 있고 **Departure date 칸에 고른 날짜(예: "Feb 15")가 들어가 있음** |

## 4. 끝

1. 만든 탭 닫기
2. 문제없이 끝났으면 `python award-tracker/tools/award.py finish ok` (멈춘 경우는 0장의 finish 를 이미 했음)
3. `python award-tracker/tools/award.py publish` → 휴대폰 앱에 반영, 목표 이하 새 좌석 · 문제 상황은 메일로 가요
4. 사용자에게 짧게 보고: 노선별 최저 마일, 새로 열린 목표 이하 날짜, 멈췄다면 어디서 왜

## 5. 결과 기록 형식 (`save` 에 넣는 JSON)

`award-tracker/tools/` 밖의 임시 파일(예: `%TEMP%\award-result.json`)에 쓰고 `save 파일경로` 로 넣거나, `save -` 로 바로 넘겨요.
`route_id` · `direction`(out 가는 편 / back 오는 편) · `cabin` 은 `start` 목록에 나온 그대로 써요. 기간 밖 날짜는 알아서 건너뛰어요.

캘린더 (날짜별 최저 마일 — 직항 · 경유 중 가장 적은 값, 좌석 없음은 `null`, 화면 글자 "15,000" 그대로 넣어도 됨):
```json
{"route_id": "sel-tyo-20270201", "direction": "out", "cabin": "economy", "source": "calendar",
 "days": {"2027-02-03": 15000, "2027-02-04": "10,000", "2027-02-05": null}}
```

상세 (그 날짜에 본 편들. `miles` 를 빼면 편 중 가장 적은 마일을 써요. 직항은 `stops: 0`, 경유는 횟수와 경유지):
```json
{"route_id": "sel-tyo-20270201", "direction": "out", "cabin": "economy", "source": "detail",
 "days": {"2027-02-04": {"tax": {"amount": 52300, "currency": "KRW"}, "seats": "2+",
   "flights": [
     {"no": "KE2101", "from": "GMP", "to": "HND", "dep": "08:10", "arr": "10:20", "stops": 0, "miles": 10000, "tax": 52300},
     {"no": "MU5042", "from": "ICN", "to": "NRT", "dep": "08:30", "arr": "16:40", "stops": 1, "via": "PVG", "miles": 15000, "tax": 61300, "operated_by": "중국동방항공"}
   ]}}}
```

## 6. 예외 상황 (만날 때마다 추가)

| 상황 | 알아보는 법 | 할 일 |
|---|---|---|
| 쿠키 동의 배너 | 페이지 위나 아래에 쿠키 동의 창이 뜸 | 모두 승인 스위치를 켜고 닫기 (사용자 지시 2026-11-24) |
| 캘린더 대신 날짜 입력을 요구함 | ❓ | ❓ |
| 캘린더 위 주황 안내 "Sorry, there are no flights available in the current month. You can view flights for the next available month below." | 검색 직후 캘린더 맨 위 | 무시하고 그대로 진행 (이번 달 좌석이 없어 다음 가능한 달을 보여 준다는 뜻) |
| 노선이 없음 / 검색 결과 없음 | ❓ | 그 달 모든 날짜 `null` 로 save |
| **검색 중 홈 화면으로 튕기며 "Something went wrong"** | 검색 · 날짜 선택 뒤 갑자기 첫 화면으로 돌아오고 "Something went wrong" 류의 안내 | 멈추지 않고 `wait search` 후 그 항목을 **이어서 재검색** (검색 칸 값 확인 → 2-7 부터). 같은 항목에서 3번 연속이면 0장 "멈추는 때" (2026-11-24 사용자 지시) |
| **캘린더가 비어 있음 (서버 렉)** | 달 띠의 그 달 칸에는 "from 9,500 Miles" 처럼 마일이 있는데, 달력 날짜 칸에는 마일이 없거나 날짜가 모두 회색(비활성) (날짜 버튼 이름에 "Lowest fare is" 가 없음) | **`null` 로 save 하지 않아요.** `wait search` 한 번 더 기다려도 그대로면 → `wait between` 두 번(약 3~5분) 쉬고 → 처음 주소(`https://wwws.airfrance.co.kr/en`)로 **한 번만** 가서 → `wait search` → 2-1 부터 다시. 그래도 비거나 홈이 오류 페이지면 바로 `finish challenge` (2026-11-24 TYO→SEL 2월은 재검색으로 풀림, SEL→OSA 2월은 재시도 중 접속 차단) |
| **크롬 오류 페이지 / 접속 차단** | navigate 결과 "ended without loading a page", 스크린샷 · 글자 읽기가 "showing error page", 사용자 크롬에서도 안 열림, 로그인이 풀림 | 다시 시도하지 않음 → 탭 닫기 → `finish challenge --message "…"` → `publish` → 사용자에게 알림. 그날은 다시 조회하지 않고, 다음 날 사용자가 직접 열리는지 확인한 뒤에 (2026-11-24 만남) |
| 대한항공 편이 안 보임 | ❓ | ❓ |

## 가르친 기록

| 날짜 | 바뀐 내용 |
|---|---|
| 2026-11-24 | 처음 가르침 (SEL↔TYO 이코노미 2월). 시작 주소 `/en`, 마일 스위치 → One-way → 도시 코드(All airports) → 날짜 비우고 "Search flights" → 달 띠에서 달 선택 → 페이지 글자로 마일 읽기. 상세: 날짜 칸 → 편 목록, 세금은 날짜 띠 USD, 편명 안 봄, 남은 좌석은 빨간 "N seats left" 없으면 2+. "← Back" 은 검색 칸으로 감, 날짜는 "Clear dates" 로 비움, ⇄ 로 방향 바꿈. 비즈니스 검색 안 함. 상세는 9,500 이하 날짜만(노선당 15회). 예외: 쿠키 모두 승인, 캘린더 빔(렉) → 홈에서 재검색, "Something went wrong" → 재검색 |
| 2026-11-24 | 상세는 그 달 최저 + 20% 이내(노선별 숫자 없음), 시작 달부터 예약 열린 달까지 모두 검색, 같은 방향 다음 달은 달 띠만 눌러 이동, 안 열린 달은 save 안 함 |
| 2026-11-24 | 비즈니스는 캘린더 검색 안 함 → 이코노미 상세 화면의 Business 칸을 함께 읽어 detail 로 저장 |
| 2026-11-24 | SEL→OSA 조회 중 접속 차단 → 무리하지 않기 기준: 한 번에 8개월 · 상세 노선당 3일, 기다림 늘림(10~20 / 30~45 / 90~150초), 하루 1번, 재시도는 한 번만, 오류 페이지면 바로 멈춤 |
| 2026-11-24 | 조회 기준 다시 정함: 요청은 버튼 · 채팅으로만, 기간은 앱에서 정한 달만(한 방향 최대 8개월), 상세는 최저 +20% · 노선당 3일 |
