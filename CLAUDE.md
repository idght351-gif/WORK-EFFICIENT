# 저장소 안내

- `flight-tracker/` — Google 항공권 현금 가격 추적 (GitHub Actions 가 매일 자동 조회). 마일 좌석 작업 중에는 건드리지 않아요.
- `award-tracker/` — 에어프랑스 Flying Blue 마일 좌석 추적. 집 PC 의 Claude 가 Claude in Chrome 으로 반자동 조회해요.
  - 조회해 달라고 하면: `award-search` 스킬 → `award-tracker/playbook/PLAYBOOK.md` 를 처음부터 끝까지 읽고 그대로 따라요.
  - 검색 절차를 가르쳐 준다고 하면: `award-teach` 스킬.
  - 결과 저장 · 앱 반영은 `python award-tracker/tools/award.py` 로만 해요 (`site/data` 를 직접 고치지 않아요).
  - 테스트: `python -m unittest discover -s award-tracker/tests -v`
