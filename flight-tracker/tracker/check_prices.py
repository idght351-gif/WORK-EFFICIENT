#!/usr/bin/env python3
"""매일 한 번 실행되어 routes.json 의 노선별 최저가를 조회·기록하고, 목표가 이하이면 메일을 보냅니다.

표준 라이브러리만 사용합니다 (별도 설치 불필요).

환경 변수
  SERPAPI_KEY          SerpApi API 키 (필수)
  GMAIL_USER           발송용 Gmail 주소 (메일 알림을 쓰려면 필수)
  GMAIL_APP_PASSWORD   Gmail 앱 비밀번호 16자리
  ALERT_EMAIL          알림 받을 주소 (없으면 GMAIL_USER 로 보냄)
  SITE_URL             GitHub Pages 주소 (메일에 링크로 넣음, 선택)
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
ROUTES_FILE = ROOT / "routes.json"
DATA_DIR = ROOT / "site" / "data"

TRAVEL_CLASS = {"economy": 1, "premium_economy": 2, "business": 3, "first": 4}
# SerpApi stops: 0 = 상관없음, 1 = 직항만, 2 = 1회 경유 이하, 3 = 2회 경유 이하
STOPS = {None: 0, 0: 1, 1: 2, 2: 3}


# ---------------------------------------------------------------- 시간 유틸

def now_kst() -> datetime:
    return datetime.now(KST)


def parse_hm(value: str) -> int:
    """'09:30' -> 570 (자정부터 분)."""
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def outbound_times_param(after: str, before: str) -> str:
    """SerpApi outbound_times 는 시 단위 범위("9,11" = 9:00~11:59)."""
    a, b = parse_hm(after), parse_hm(before)
    start = a // 60
    end = (b - 1) // 60 if b > 0 else 0
    return f"{start},{max(start, min(end, 23))}"


# ---------------------------------------------------------------- 가격 조회

def build_params(route: dict, api_key: str) -> dict:
    params = {
        "engine": "google_flights",
        "departure_id": route["from"],
        "arrival_id": route["to"],
        "outbound_date": route["date"],
        "type": 1 if route.get("return_date") else 2,
        "currency": "KRW",
        "hl": "ko",
        "gl": "kr",
        "adults": route.get("adults", 1),
        "travel_class": TRAVEL_CLASS[route.get("travel_class", "economy")],
        "stops": STOPS[route.get("max_stops")],
        "outbound_times": outbound_times_param(
            route.get("depart_after", "00:00"), route.get("depart_before", "24:00")
        ),
        "api_key": api_key,
    }
    if route.get("return_date"):
        params["return_date"] = route["return_date"]
        if route.get("return_after") or route.get("return_before"):
            params["return_times"] = outbound_times_param(
                route.get("return_after", "00:00"), route.get("return_before", "24:00")
            )
    return params


def fetch_serpapi(params: dict, retries: int = 3) -> dict:
    url = "https://serpapi.com/search.json?" + urllib.parse.urlencode(params)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = json.load(resp)
            if data.get("error") and "hasn't returned any results" not in data["error"]:
                raise RuntimeError(data["error"])
            return data
        except (urllib.error.URLError, RuntimeError, TimeoutError) as e:
            last_err = e
            if attempt < retries - 1:
                import time
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"SerpApi 조회 실패: {last_err}")


def pick_cheapest(data: dict, route: dict, leg: str = "depart") -> dict | None:
    """응답에서 출발 시간대 안의 최저가 항공편 하나를 고릅니다. leg="return" 이면 오는 편 시간대를 씁니다."""
    after = parse_hm(route.get(f"{leg}_after") or "00:00")
    before = parse_hm(route.get(f"{leg}_before") or "24:00")
    best = None
    for item in (data.get("best_flights") or []) + (data.get("other_flights") or []):
        price = item.get("price")
        legs = item.get("flights") or []
        if not price or not legs:
            continue
        dep = legs[0].get("departure_airport", {}).get("time", "")  # "2026-12-20 09:05"
        arr = legs[-1].get("arrival_airport", {}).get("time", "")
        try:
            dep_min = parse_hm(dep.split(" ")[1])
        except (IndexError, ValueError):
            continue
        if not (after <= dep_min <= before):
            continue
        if best is None or price < best["price"]:
            best = {
                "price": int(price),
                "airline": " + ".join(dict.fromkeys(l.get("airline", "") for l in legs)),
                "flight_number": ", ".join(l.get("flight_number", "") for l in legs),
                "depart_time": dep.split(" ")[1] if " " in dep else dep,
                "arrive_time": arr.split(" ")[1] if " " in arr else arr,
                "stops": len(legs) - 1,
                "duration_min": item.get("total_duration"),
                "departure_token": item.get("departure_token"),
            }
    return best


def check_route(route: dict, api_key: str) -> tuple[dict | None, dict, str | None]:
    """가는 편 검색 → (왕복이면) 그 가는 편으로 오는 편 검색. 가격은 항상 전체 인원 왕복/편도 총액."""
    params = build_params(route, api_key)
    data = fetch_serpapi(params)
    insights = data.get("price_insights") or {}
    url = (data.get("search_metadata") or {}).get("google_flights_url")
    out = pick_cheapest(data, route, "depart")
    if out and route.get("return_date") and out.get("departure_token"):
        try:
            data2 = fetch_serpapi({**params, "departure_token": out["departure_token"]})
            ret = pick_cheapest(data2, route, "return")
            if ret:
                out["price"] = ret["price"]  # 오는 편 검색 결과의 가격 = 왕복 총액
                for k in ("airline", "flight_number", "depart_time", "arrive_time", "stops"):
                    out[f"return_{k}"] = ret[k]
                url = (data2.get("search_metadata") or {}).get("google_flights_url") or url
            else:
                out = None  # 오는 편 시간대에 맞는 편이 없음
        except RuntimeError as e:
            print(f"  ! 오는 편 조회 실패, 가는 편 기준 가격만 기록: {e}")
    if out:
        out.pop("departure_token", None)
    return out, insights, url


# ---------------------------------------------------------------- 기록 / 알림 판단

def record_result(history: list, today: str, result: dict | None, error: str | None,
                  checked_at: str, insights: dict) -> list:
    """오늘 항목을 추가·교체합니다. 오늘 이미 성공 기록이 있으면 실패로 덮어쓰지 않습니다."""
    existing = next((h for h in history if h["date"] == today), None)
    if existing and existing.get("price") is not None and result is None:
        return history
    entry = {"date": today, "checked_at": checked_at, "price": None, "error": error}
    if result:
        entry.update(result)
        entry["error"] = None
    elif error is None:
        entry["error"] = "조건에 맞는 항공편 없음 (매진·시간대 불일치)"
    if insights.get("price_level"):
        entry["price_level"] = insights["price_level"]
    if insights.get("typical_price_range"):
        entry["typical_range"] = insights["typical_price_range"]
    history = [h for h in history if h["date"] != today] + [entry]
    history.sort(key=lambda h: h["date"])
    return history


def decide_alert(price: int | None, threshold: int | None, state: dict) -> tuple[bool, dict]:
    """목표가 이하로 처음 내려갔을 때, 또는 지난 알림보다 더 내려갔을 때만 보냅니다.
    목표가 위로 다시 올라가면 상태를 초기화해서 다음 하락 때 다시 알립니다."""
    state = dict(state or {})
    if price is None or not threshold:
        return False, state
    if price > threshold:
        state["last_alert_price"] = None
        return False, state
    last = state.get("last_alert_price")
    if last is None or price < last:
        state["last_alert_price"] = price
        return True, state
    return False, state


def summarize(history: list) -> dict:
    prices = [h["price"] for h in history if h.get("price") is not None]
    if not prices:
        return {"current": None, "min": None, "max": None, "avg": None, "prev": None}
    ok = [h for h in history if h.get("price") is not None]
    return {
        "current": ok[-1]["price"],
        "current_date": ok[-1]["date"],
        "prev": ok[-2]["price"] if len(ok) > 1 else None,
        "min": min(prices),
        "max": max(prices),
        "avg": round(sum(prices) / len(prices)),
        "days": len(prices),
    }


# ---------------------------------------------------------------- 메일

def won(v: int) -> str:
    return f"{v:,}원"


def send_alert(route: dict, entry: dict, summary: dict, flights_url: str | None) -> None:
    user = os.environ.get("GMAIL_USER")
    pw = os.environ.get("GMAIL_APP_PASSWORD")
    to = os.environ.get("ALERT_EMAIL") or user
    if not (user and pw and to):
        print("  ! 메일 설정(GMAIL_USER / GMAIL_APP_PASSWORD)이 없어 알림을 건너뜁니다.")
        return
    is_low = summary["min"] == entry["price"]
    trip = f"{route['date']}" + (f" ~ {route['return_date']}" if route.get("return_date") else " 편도")
    msg = EmailMessage()
    msg["Subject"] = (f"[항공권 알림] {route['name']} {won(entry['price'])}"
                      f" — 목표가 {won(route['alert_below'])} 이하" + (" · 역대 최저" if is_low else ""))
    msg["From"] = user
    msg["To"] = to
    lines = [
        f"{route['name']} ({route['from']} → {route['to']})",
        f"일정: {trip}",
        "",
        f"오늘 최저가: {won(entry['price'])}" + ("  ← 추적 시작 후 최저가!" if is_low else ""),
        f"목표가: {won(route['alert_below'])}",
        f"가는 편: {entry.get('airline')} {entry.get('flight_number')}  "
        f"{entry.get('depart_time')} → {entry.get('arrive_time')}"
        + (" 직항" if entry.get("stops") == 0 else f" 경유 {entry.get('stops')}회"),
    ]
    if entry.get("return_airline"):
        lines.append(f"오는 편: {entry['return_airline']} {entry['return_flight_number']}  "
                     f"{entry['return_depart_time']} → {entry['return_arrive_time']}")
    lines += [
        f"(성인 {route.get('adults', 1)}명 총액)",
        "",
        f"추적 기간 최저 {won(summary['min'])} · 평균 {won(summary['avg'])} · 최고 {won(summary['max'])}",
    ]
    if flights_url:
        lines += ["", f"Google 항공권에서 보기: {flights_url}"]
    if os.environ.get("SITE_URL"):
        lines += [f"가격 추이 그래프: {os.environ['SITE_URL'].rstrip('/')}/#{route['id']}"]
    msg.set_content("\n".join(lines))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
        s.login(user, pw)
        s.send_message(msg)
    print(f"  ✉ 알림 메일 발송 → {to}")


# ---------------------------------------------------------------- 메인

def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(dry_run: bool = False) -> int:
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key and not dry_run:
        print("SERPAPI_KEY 환경 변수가 없습니다.", file=sys.stderr)
        return 1
    routes = load_json(ROUTES_FILE, {"routes": []})["routes"]
    now = now_kst()
    today = now.date().isoformat()
    index = []
    failures = 0

    for route in routes:
        rid = route["id"]
        path = DATA_DIR / "routes" / f"{rid}.json"
        doc = load_json(path, {"history": [], "alert_state": {}})
        history = doc.get("history", [])
        status = "active"

        if date.fromisoformat(route["date"]) < now.date():
            status = "ended"
        elif not route.get("active", True):
            status = "paused"

        print(f"- {route['name']} [{rid}] ({status})")
        if status == "active" and not dry_run:
            result, error, insights, url = None, None, {}, None
            try:
                result, insights, url = check_route(route, api_key)
            except Exception as e:  # noqa: BLE001 - 한 노선 실패가 전체를 멈추지 않게
                error = str(e).replace(api_key, "***")
                failures += 1
            history = record_result(history, today, result, error, now.isoformat(timespec="seconds"), insights)
            doc["google_flights_url"] = url or doc.get("google_flights_url")
            print(f"  가격: {won(result['price']) if result else '없음'}" + (f" (오류: {error})" if error else ""))

            summary = summarize(history)
            should_send, doc["alert_state"] = decide_alert(
                result["price"] if result else None, route.get("alert_below"), doc.get("alert_state")
            )
            if should_send:
                try:
                    send_alert(route, history[-1], summary, doc.get("google_flights_url"))
                except Exception as e:  # noqa: BLE001
                    print(f"  ! 메일 발송 실패: {e}", file=sys.stderr)
                    doc["alert_state"]["last_alert_price"] = None  # 다음 실행 때 재시도

        doc["route"] = route
        doc["status"] = status
        doc["history"] = history
        doc["summary"] = summarize(history)
        doc["updated_at"] = now.isoformat(timespec="seconds")
        save_json(path, doc)
        index.append({
            "id": rid, "name": route["name"], "from": route["from"], "to": route["to"],
            "date": route["date"], "return_date": route.get("return_date"),
            "alert_below": route.get("alert_below"), "status": status,
            "summary": doc["summary"],
            "spark": [h["price"] for h in history if h.get("price") is not None][-30:],
        })

    save_json(DATA_DIR / "index.json", {"updated_at": now.isoformat(timespec="seconds"), "routes": index})
    # 모든 노선이 실패했을 때만 실패 코드 → GitHub Actions 에서 빨간불로 보임
    active = sum(1 for r in index if r["status"] == "active")
    return 1 if active and failures == active else 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="API 호출 없이 index.json 만 다시 만듭니다")
    sys.exit(run(dry_run=p.parse_args().dry_run))
