# ✈︎ 마일 좌석 추적 (에어프랑스 Flying Blue · 반자동)

에어프랑스 Flying Blue 마일로 발권할 수 있는 **스카이팀 한일 노선**(대한항공, 12/17부터 대한항공 편명으로 바뀌는 (구)아시아나 등, 직항 · 경유 모두)의 마일리지 좌석을 날짜별로 보여주는 앱이에요.
기존 **항공권 가격 추적**(`flight-tracker/`)과는 따로 동작해요.

**방식: 사람과 Claude 가 같이 만드는 반자동 매크로**
1. 처음 한 번, 집 PC 크롬에서 사용자가 "이 버튼 → 그다음 이 버튼"을 알려 주면 Claude 가 같이 눌러 보면서 **검색 절차서**(`playbook/PLAYBOOK.md`)에 적어요.
2. 그다음부터는 **필요할 때 PC 바탕화면의 "마일 좌석 조회" 버튼**을 누르면, Claude 가 절차서대로 **버튼 하나 누르고 넉넉히 기다리고, 다음 버튼 누르고 또 기다리는** 식으로 천천히 검색해요.
   정해진 시간에 저절로 돌지 않아요. 버튼을 누를 때만 조회해요.
3. 읽은 마일 · 세금은 휴대폰 앱에 올라가고, 목표 마일 이하 좌석이 새로 열리면 메일이 와요.

```
집 PC: Claude Code + Claude in Chrome (사용자 크롬, 에어프랑스 로그인 그대로)
  └─ 절차서대로: 클릭 → 8~15초 기다림 → 클릭 → … → 검색 → 20~35초 기다림 → 캘린더 글자 읽기
  └─ 목표 이하 날짜만 편 상세까지 열어 세금 · 유류할증료 확인 (결제 단계 전에서 멈춤)
  └─ award.py 로 결과 저장 → GitHub 에 올림
GitHub → 휴대폰 앱 (https://<아이디>.github.io/flight-tracker/award/) · 알림 메일
```

## 진행 단계

| 단계 | 하는 일 | 상태 |
|---|---|---|
| 0 | 휴대폰 앱 화면, 결과 저장 도구, 알림 메일, 절차서 틀 | ✅ 완료 (앱은 샘플 데이터) |
| 1 | 집 PC 준비 (아래 순서, 한 번만) | 사용자 |
| 2 | 가르치기: 같이 한 노선을 끝까지 검색하며 절차서 채우기 (30분~1시간) | 같이 |
| 3 | 연습: Claude 혼자 절차서대로, 사용자는 지켜보며 고치기 | 같이 |
| 4 | 필요할 때: PC 의 "마일 좌석 조회" 버튼 → Claude 가 조회 | 사용자 버튼 → Claude |

## 1. 집 PC 준비 (Windows, 한 번만)

1. **Git for Windows** 설치: https://git-scm.com/download/win (Claude Code 가 Windows 에서 씀)
2. **Python 3** 설치: https://www.python.org/downloads/ (설치 첫 화면에서 **Add python.exe to PATH** 체크)
3. **저장소 내려받기**: 문서 폴더 같은 곳에서 (숨김 폴더 · 홈 폴더 바로 아래 숨김 폴더는 피해요)
   ```
   git clone https://github.com/<아이디>/flight-tracker.git
   ```
   처음 `push` 할 때 GitHub 로그인 창이 뜨면 로그인해요 (Git Credential Manager).
4. **Claude Code** 를 설치하고 Claude 계정으로 로그인해요 (`/login`). API 키 로그인은 크롬 연결이 꺼져요.
   Claude 데스크탑 앱의 Code 화면이나 터미널(`claude`) 어느 쪽이든 내려받은 `flight-tracker` 폴더에서 열어요.
5. **크롬 연결**: `claude --chrome` 으로 시작하거나 대화 중 `/chrome` → 안내대로 **Claude in Chrome** 확장 설치 → `/chrome` 에서 `Status: Enabled` 확인.
   - 연결이 안 되면 크롬을 다시 시작해 보고, 오래 쉬다 끊기면 `/chrome` → Reconnect extension.
   - 참고: https://code.claude.com/docs/ko/chrome
6. 크롬에서 **에어프랑스에 로그인**해 둬요. Claude 가 에어프랑스 사이트 사용 허락을 물으면 허용해요.
7. **바탕화면 버튼 만들기**: 내려받은 폴더의 `award-tracker\pc` 에 있는 두 파일을 바탕화면에 바로 가기로 만들어요.
   - 파일 오른쪽 클릭 → (Windows 11 은 "추가 옵션 표시") → **보내기 → 바탕 화면에 바로 가기 만들기**
   - 바로 가기 이름을 바꿔요: `award-search.cmd` → **마일 좌석 조회**, `award-teach.cmd` → **마일 검색 가르치기**
   - 누르면 검은 창이 열리고 Claude Code 가 크롬 연결 상태로 시작해서 바로 조회(또는 가르치기)를 시작해요. 끝나면 창을 닫아요.
8. **처음 한 번만, 허락 창 정리**: 처음 조회할 때 Claude 가 `python award-tracker/tools/award.py …`(기다리기 · 결과 저장) 명령을 써도 되는지 물어요.
   **"예, 다시 묻지 않기"(Yes, and don't ask again)** 를 고르면 다음부터는 기다릴 때마다 멈추지 않아요. 크롬 조작 허락도 같은 방식으로 물어보면 원하는 대로 골라요.

## 2. 가르치기

바탕화면의 **마일 검색 가르치기** 버튼을 누르거나, Claude Code 에서 이렇게 말하면 돼요: **"에어프랑스 마일 검색 가르쳐 줄게"**

- Claude 가 화면을 읽고 "다음은 ○○ 버튼 누를까요?"라고 물어요. 맞으면 "응", 아니면 "아니, 오른쪽 위 파란 ○○ 버튼"처럼 알려 주세요.
- 누를 때마다 넉넉히 기다린 뒤 다음으로 가고, 단계마다 절차서에 적어요 (버튼 이름 · 위치 설명 · 기다림 · 확인 단서).
- 연습할 노선이 없으면 Claude 가 물어봐요 (예: 인천 → 나리타, 2027년 6월).
- 끝나면 절차서를 GitHub 에 올려 두니까, 다음에 다른 PC 세션에서도 그대로 써요.

## 3. 필요할 때 조회하기

바탕화면의 **마일 좌석 조회** 버튼을 눌러요 (Claude Code 에서 "마일 좌석 조회해 줘"라고 해도 같아요).
Claude 가 절차서를 처음부터 읽고, 켜 둔 노선을 하나씩 천천히 검색한 뒤 휴대폰 앱에 올려요. **정해진 시간에 저절로 돌지 않고, 버튼을 누를 때만** 조회해요.

- 걸리는 시간: 캘린더 검색 1회에 약 3~4분 (클릭마다 기다림 포함). 노선 하나(1개월, 이코노미 · 비즈니스, 왕복)면 캘린더 4회 + 상세 몇 번으로 약 15~25분이에요.
- 조회하는 동안 PC · 크롬이 켜져 있어야 해요. 다른 탭에서 크롬을 써도 되지만, Claude 가 쓰는 탭은 건드리지 않아요.
- 휴대폰 앱의 "집 PC 조회" 카드에 마지막 조회 시각과 "N일 전 조회"가 보여서, 갱신이 필요한지 알 수 있어요.

## 휴대폰 앱

`main` 에 합치면 `https://<아이디>.github.io/flight-tracker/award/` 에 배포돼요 (기존 가격 추적 앱 주소는 그대로). 첫 실제 조회 전까지는 **샘플 데이터**가 보여요.

- **iPhone (Safari)**: 공유 → "홈 화면에 추가" / **Android (Chrome)**: ⋮ → "홈 화면에 추가"
- **열면 바로 월 달력**: 날짜 칸마다 최저 마일(예: 12.5k). 초록 = 목표 마일 이하 (목표가 없으면 기간 최저), 회색 = 좌석 있음, – = 좌석 없음, 빈 칸 = 아직 조회 전, 파란 점 = 새로 열림
  - 맨 위 **노선 탭**(예: 인천→나리타 · 김포→하네다)을 눌러 노선을 바꾸고, 가는 편 / 오는 편 · 이코노미 / 비즈니스를 골라요. ‹ › 로 달을 넘겨요 (마지막으로 보던 화면을 기억해요)
  - 날짜를 누르면 아래에 마일, 추가 비용(세금 · 유류할증료), 남은 좌석, 지난 조회 대비, 편명이 나와요
  - 달력 아래에 **마지막 조회** 시각 (조회가 멈췄으면 이유도 함께)
- 노선 탭 끝의 **+ 노선**, 맨 아래 **이 노선 조건 바꾸기**: 한일 노선 목록에서 골라 기간 · 등급 · 목표 마일을 정하면 `routes.json` 에 넣을 내용과 걸리는 시간을 보여줘요

## 노선 설정 (`award-tracker/routes.json`)

앱의 **+ 노선 추가하기**에서 만든 내용을 `"routes": [ … ]` 안에 붙여 넣고 저장(Commit)해요. 다음 조회 때부터 포함돼요.

```jsonc
{
  "id": "sel-tyo-20270201",
  "name": "서울 → 도쿄",
  "from": "SEL", "to": "TYO",                               // 도시 코드: SEL(인천·김포) TYO(나리타·하네다) OSA(간사이·이타미·고베)
  "start": "2027-02-01", "end": "2027-02-28",              // 가는 편 출발 기간
  "return_start": "2027-02-01", "return_end": "2027-02-28", // 오는 편 (편도면 null)
  "cabins": ["economy", "business"],
  "target_miles": null,                                     // 예: { "economy": 15000 } 이하로 열리면 메일. null 이면 알림 없이 기간 최저를 표시
  "nonstop": false, "adults": 1,                             // false = 직항 · 경유 모두, true = 직항만
  "active": true                                              // false = 일시 중지
}
```

`settings`
- `wait_seconds`: 기다리는 시간(초). `click` 버튼마다, `search` 결과를 불러오는 버튼 뒤, `between` 검색과 검색 사이. 더 느긋하게 하려면 숫자를 키워요.
- `max_searches_per_run`: 한 번 조회할 때 캘린더 검색 최대 횟수. 넘치면 오래된 것부터 하고 나머지는 다음 조회로 미뤄요.
- `max_details_per_route`: 노선마다 한 번 조회할 때 상세 확인 최대 횟수.
- `airfrance_url`: 가르치기 때 정한 에어프랑스 주소.

## 알림 메일

조회가 끝나 결과가 올라가면 GitHub Actions(`마일 좌석 알림`)가 메일을 보내요. 항공권 가격 추적과 같은 Gmail 설정(`GMAIL_USER`, `GMAIL_APP_PASSWORD`)을 쓰고, 받는 주소는 `ALERT_EMAIL` 비밀값, 없으면 `GMAIL_USER` 예요.
- 목표 마일 이하로 **새로 열렸거나 더 싸진** 날짜가 있을 때 (처음 조회한 노선은 목표 이하 날짜를 한 줄로 묶어서)
- 조회가 **로그인 필요 · 보안 확인 · 실패**로 멈췄을 때
- 아무 변화 없으면 메일을 보내지 않아요.

## 안전 원칙

- 본인 계정으로 조회하는 거라 천천히, 탭 하나로만 해요. 버튼을 누를 때만 돌고, 하루에 여러 번 누르지 않는 걸 권해요.
- 보안 확인(캡차)이 뜨면 **풀지 않고 멈추고** 알려요. 로그인이 풀리면 비밀번호를 넣지 않고 사용자에게 부탁해요.
- 예약 · 결제 · 마일 사용 버튼은 누르지 않아요. 세금이 보이는 화면까지만 가요.
- 결과로 올라가는 건 노선 · 날짜 · 마일 · 세금 · 편명뿐이에요 (저장소가 공개라 앱 데이터도 공개). 이름 · 회원번호 · 잔여 마일은 저장하지 않아요.

## 폴더 구조

```
award-tracker/
  pc/                    바탕화면 버튼: award-search.cmd (조회), award-teach.cmd (가르치기)
  playbook/PLAYBOOK.md   검색 절차서 (가르치며 채움, 조회 때마다 Claude 가 읽음)
  tools/award.py         start · wait · save · finish · publish · send-alerts
  site/                  휴대폰 앱 (GitHub Pages /award/), site/data 에 조회 결과
  routes.json            추적할 노선과 설정
  tests/                 award.py 테스트
.claude/skills/          award-teach (가르치기), award-search (조회)
```

## 명령 (Claude 가 쓰지만 직접 써도 돼요)

```bash
python award-tracker/tools/award.py start          # 조회 시작 + 검색 목록
python award-tracker/tools/award.py wait click     # 8~15초 기다림 (search / between)
python award-tracker/tools/award.py save 결과.json  # 읽은 결과 저장 (형식은 절차서 5장)
python award-tracker/tools/award.py finish ok      # 조회 끝 (login_required / challenge / error)
python award-tracker/tools/award.py publish        # 앱에 반영 (commit · push)
python -m unittest discover -s award-tracker/tests -v   # 테스트
cd award-tracker/site && python -m http.server 8000     # 앱 미리 보기 http://localhost:8000
```
