---
name: award-search
description: 에어프랑스 Flying Blue 마일리지 좌석 조회를 실행할 때 쓴다. 예 "마일 좌석 조회해 줘", "에어프랑스 마일 검색 돌려 줘", "조회 시작", 예약 작업으로 시작된 조회. award-tracker/playbook/PLAYBOOK.md 를 따라 Claude in Chrome 으로 천천히 검색하고 결과를 휴대폰 앱에 올린다.
---

# 마일 좌석 조회

1. `award-tracker/playbook/PLAYBOOK.md` 를 **처음부터 끝까지** 읽어요. 매번 읽어요 (사용자가 고쳤을 수 있어요).
2. 절차서 맨 위 상태가 `가르치기 전` 이면 조회하지 말고, 사용자에게 먼저 같이 해 보자고 해요 (`award-teach`).
   `일부 가르침` 이면 ❓ 가 남은 단계에 닿았을 때 멈추고 사용자에게 물어요. 사람이 없으면 `finish error --message "절차서 ❓: 단계 번호"` 후 publish.
3. 절차서 1 → 2 → 3 → 4장 순서 그대로 해요. 클릭마다 기다리기를 빼먹지 않아요 (`award.py wait click|search|between`).
4. 진행 중에는 항목마다 한 줄씩만 알려요 (예: "3/8 ICN→NRT 비즈니스 6월: 최저 30,000, 목표 이하 2일 → 상세 확인").
5. 절차서와 다른 화면이 나오면 추측해서 계속하지 말고 0장 "멈추는 때"를 따라요.
6. 끝나면 `finish` → `publish` 를 꼭 하고, 노선별 최저 마일과 새로 열린 목표 이하 날짜를 짧게 보고해요.
