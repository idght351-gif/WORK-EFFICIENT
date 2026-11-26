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
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from html import escape
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

def is_multi(route: dict) -> bool:
    return bool(route.get("legs"))


# ---------------------------------------------------------------- 지역(나라 전체) · 유연한 날짜

# 나라 전체를 뜻하는 코드 → Google 위치 ID(kgmid). 공항 코드와 쉼표로 섞어 써도 됨 ("KR" , "ICN,GMP", "JP")
REGIONS = {"KR": "/m/06qd3", "JP": "/m/03_3d"}
WEEKDAY_KO = "월화수목금토일"


def resolve_place(codes: str) -> str:
    """"KR" → "/m/06qd3", "ICN, gmp" → "ICN,GMP"."""
    out = []
    for c in codes.split(","):
        c = c.strip()
        if c:
            out.append(c if c.startswith("/") else REGIONS.get(c.upper(), c.upper()))
    return ",".join(out)


def is_flex(route: dict) -> bool:
    return bool(route.get("flex"))


def flex_dates(flex: dict) -> list[date]:
    """flex = {"months": ["2027-02"], "weekdays": [4, 5]}  (요일: 0=월 … 6=일, 비우면 모든 요일)."""
    days = set(flex.get("weekdays") or range(7))
    out = []
    for m in sorted(set(flex.get("months") or [])):
        y, mo = map(int, m.split("-"))
        d = date(y, mo, 1)
        while d.month == mo:
            if d.weekday() in days:
                out.append(d)
            d += timedelta(days=1)
    return out


def flex_label(flex: dict) -> str:
    months = " · ".join(f"{int(m[:4])}년 {int(m[5:])}월" for m in sorted(flex.get("months") or []))
    wd = flex.get("weekdays")
    days = "·".join(WEEKDAY_KO[i] for i in sorted(wd)) + "요일" if wd and len(wd) < 7 else "모든 요일"
    trip = f" · {flex['trip_days']}박 왕복" if flex.get("trip_days") else " · 편도"
    return f"{months} {days}{trip}"


def normalize_route(route: dict) -> dict:
    """다구간 노선은 첫 구간 출발지·날짜와 마지막 도착지를 from/to/date 로 채워 다른 코드와 맞춥니다.
    유연한 날짜 노선은 아직 지나지 않은 첫 후보일을 date 로 (모두 지났으면 마지막 후보일 → 추적 종료)."""
    if is_flex(route):
        cands = flex_dates(route["flex"])
        today = now_kst().date()
        first = next((d for d in cands if d >= today), cands[-1] if cands else today)
        days = route["flex"].get("trip_days")
        return {**route, "date": first.isoformat(),
                "return_date": (first + timedelta(days=int(days))).isoformat() if days else None,
                "trip_type": "flex"}
    if is_multi(route):
        legs = route["legs"]
        route = {**route, "from": legs[0]["from"], "to": legs[-1]["to"], "date": legs[0]["date"],
                 "return_date": None, "trip_type": "multi_city"}
    return route


MIN_CONNECTION_MIN = 120  # 같은 날 이어지는 구간의 최소 환승 시간(분). 노선에 min_connection_min 으로 바꿀 수 있음


NO_CONNECTION = "no-connection"


def connection_after(prev: dict, leg: dict, after: str | None, min_conn: int) -> str | None:
    """앞 구간과 같은 날 출발하는 구간이면, 앞 편 도착 + 최소 환승 시간 이후로 출발 시각을 제한합니다.
    자정을 넘기면 같은 날 환승이 불가능하므로 NO_CONNECTION."""
    if prev.get("date") != leg["date"] or not prev.get("arrive_time"):
        return after
    earliest = parse_hm(prev["arrive_time"]) + min_conn
    if earliest >= 24 * 60:
        return NO_CONNECTION
    if after and parse_hm(after) >= earliest:
        return after
    return f"{earliest // 60:02d}:{earliest % 60:02d}"


def build_multi_params(route: dict, api_key: str) -> dict:
    return {
        "engine": "google_flights",
        "type": 3,
        "multi_city_json": json.dumps([
            {"departure_id": l["from"].upper(), "arrival_id": l["to"].upper(), "date": l["date"]}
            for l in route["legs"]
        ], separators=(",", ":")),
        "currency": "KRW",
        "hl": "ko",
        "gl": "kr",
        "adults": route.get("adults", 1),
        "travel_class": TRAVEL_CLASS[route.get("travel_class", "economy")],
        "stops": STOPS[route.get("max_stops")],
        "api_key": api_key,
    }


def describe_options(data: dict, route: dict, window: tuple[str | None, str | None]) -> str:
    """검색 결과 수 / 경유 조건 통과 수 / 시간대까지 통과 수."""
    items = (data.get("best_flights") or []) + (data.get("other_flights") or [])
    max_stops = route.get("max_stops")
    after, before = parse_hm(window[0] or "00:00"), parse_hm(window[1] or "24:00")
    stops_ok = [it for it in items if it.get("flights") and (max_stops is None or len(it["flights"]) - 1 <= max_stops)]

    def dep_ok(it):
        try:
            return after <= parse_hm(it["flights"][0]["departure_airport"]["time"].split(" ")[1]) <= before
        except (KeyError, IndexError, ValueError):
            return False
    return f"검색 결과 {len(items)}개 · 경유 조건 통과 {len(stops_ok)}개 · 시간대까지 통과 {sum(map(dep_ok, stops_ok))}개"


def check_separate(route: dict, api_key: str) -> tuple[dict | None, dict, str | None]:
    """다구간을 구간별 편도 항공권으로 따로 검색해 합산합니다 (저가항공 조합처럼 한 장으로 묶어 팔지 않는 경우).
    구간마다 검색 1회. 같은 날 이어지는 구간은 앞 편 도착 + 환승 시간 이후 편만 고릅니다."""
    insights, url, picked = {}, None, []
    for i, leg in enumerate(route["legs"]):
        one = {**route, "from": leg["from"], "to": leg["to"], "date": leg["date"], "return_date": None, "legs": None}
        params = build_params(one, api_key)
        params.pop("outbound_times", None)  # 시간대는 아래에서 직접 거름(환승 조건과 함께)
        data = fetch_serpapi(params)
        if i == 0:
            insights = data.get("price_insights") or {}
            url = (data.get("search_metadata") or {}).get("google_flights_url")
        after = leg.get("depart_after")
        if i:
            after = connection_after(picked[-1], leg, after, route.get("min_connection_min", MIN_CONNECTION_MIN))
            if after is NO_CONNECTION:
                raise RuntimeError(f"{i + 1}구간 {leg['from']}→{leg['to']} 같은 날 환승 시간이 모자람")
        best = pick_cheapest(data, route, window=(after, leg.get("depart_before")))
        if not best:
            raise RuntimeError(f"{i + 1}구간 {leg['from']}→{leg['to']} 조건에 맞는 편 없음 "
                               f"({describe_options(data, route, (after, leg.get('depart_before')))})")
        best.update({"from": leg["from"].upper(), "to": leg["to"].upper(), "date": leg["date"]})
        picked.append(best)
    first = picked[0]
    out = {k: first[k] for k in ("airline", "flight_number", "depart_time", "arrive_time", "stops", "duration_min")}
    out["price"] = sum(p["price"] for p in picked)
    out["legs"] = [{k: p[k] for k in ("from", "to", "date", "airline", "flight_number",
                                      "depart_time", "arrive_time", "stops", "price")} for p in picked]
    out["separate_tickets"] = True
    return out, insights, url


def check_multi(route: dict, api_key: str) -> tuple[dict | None, dict, str | None]:
    """다구간: 1구간 검색 → 고른 편의 departure_token 으로 다음 구간 검색 … 마지막 구간 가격 = 전체 여정 총액.
    구간마다 검색 1회를 씁니다."""
    params = build_multi_params(route, api_key)
    data = fetch_serpapi(params)
    insights = data.get("price_insights") or {}
    url = (data.get("search_metadata") or {}).get("google_flights_url")
    picked = []
    for i, leg in enumerate(route["legs"]):
        after = leg.get("depart_after")
        if i:
            data = fetch_serpapi({**params, "departure_token": picked[-1]["departure_token"]})
            url = (data.get("search_metadata") or {}).get("google_flights_url") or url
            after = connection_after(picked[-1], leg, after, route.get("min_connection_min", MIN_CONNECTION_MIN))
            if after is NO_CONNECTION:
                return None, insights, url  # 같은 날 환승 시간이 모자람
        best = pick_cheapest(data, route, window=(after, leg.get("depart_before")))
        if not best:
            # 어느 구간에서 왜 걸러졌는지 기록에 남김
            raise RuntimeError(f"{i + 1}구간 {leg['from']}→{leg['to']} 조건에 맞는 편 없음 "
                               f"({describe_options(data, route, (after, leg.get('depart_before')))})")
        best.update({"from": leg["from"].upper(), "to": leg["to"].upper(), "date": leg["date"]})
        picked.append(best)
        if i < len(route["legs"]) - 1 and not best.get("departure_token"):
            raise RuntimeError(f"{i + 1}구간 다음 조회용 토큰이 없습니다")
    first = picked[0]
    out = {k: first[k] for k in ("airline", "flight_number", "depart_time", "arrive_time", "stops", "duration_min")}
    out["price"] = picked[-1]["price"]
    out["legs"] = [{k: p[k] for k in ("from", "to", "date", "airline", "flight_number",
                                      "depart_time", "arrive_time", "stops")} for p in picked]
    return out, insights, url


def build_params(route: dict, api_key: str) -> dict:
    params = {
        "engine": "google_flights",
        "departure_id": resolve_place(route["from"]),  # "ICN,GMP" 처럼 여러 공항, "KR" 같은 나라 전체 가능
        "arrival_id": resolve_place(route["to"]),
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


def pick_cheapest(data: dict, route: dict, leg: str = "depart",
                  window: tuple[str | None, str | None] | None = None) -> dict | None:
    """응답에서 출발 시간대·경유 조건 안의 최저가 항공편 하나를 고릅니다.
    leg="return" 이면 오는 편 시간대를, window 를 주면 그 시간대를 씁니다.
    SerpApi 는 departure_token 으로 이어서 조회할 때 경유·시간 필터를 적용하지 않으므로 여기서 직접 거릅니다."""
    a, b = window if window else (route.get(f"{leg}_after"), route.get(f"{leg}_before"))
    after, before = parse_hm(a or "00:00"), parse_hm(b or "24:00")
    max_stops = route.get("max_stops")
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
        if max_stops is not None and len(legs) - 1 > max_stops:
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
                "dep_airport": legs[0].get("departure_airport", {}).get("id"),
                "arr_airport": legs[-1].get("arrival_airport", {}).get("id"),
            }
    return best


def check_flex(route: dict, api_key: str) -> tuple[dict | None, dict, str | None]:
    """유연한 날짜: 가격 달력 1회로 후보일(월·요일) 중 가장 싼 날을 고르고, 그날 상세 검색으로 항공편을 확인."""
    flex = route["flex"]
    today = now_kst().date()
    cands = [d for d in flex_dates(flex) if d >= today]
    if not cands:
        raise RuntimeError("남은 후보 날짜가 없음")
    days = flex.get("trip_days")
    params = {
        "engine": "google_flights_calendar",
        "departure_id": resolve_place(route["from"]),
        "arrival_id": resolve_place(route["to"]),
        "type": 1 if days else 2,
        "date_range_start": cands[0].isoformat(),
        "date_range_end": cands[-1].isoformat(),
        "currency": "KRW", "hl": "ko", "gl": "kr",
        "adults": route.get("adults", 1),
        "travel_class": TRAVEL_CLASS[route.get("travel_class", "economy")],
        "stops": STOPS[route.get("max_stops")],
        "api_key": api_key,
    }
    if days:
        params["round_trip_days"] = int(days)
    if route.get("depart_after") or route.get("depart_before"):
        params["outbound_times"] = outbound_times_param(route.get("depart_after", "00:00"), route.get("depart_before", "24:00"))
    cal = fetch_serpapi(params)
    wanted = {d.isoformat() for d in cands}
    prices = sorted((p for p in cal.get("prices") or [] if p.get("price") and p.get("outbound_date") in wanted),
                    key=lambda p: p["price"])
    if not prices:
        raise RuntimeError(f"가격 달력에 조건 맞는 날짜 없음 (후보 {len(cands)}일, 달력 결과 {len(cal.get('prices') or [])}일)")
    best = prices[0]
    one = {**route, "flex": None, "trip_type": None, "date": best["outbound_date"],
           "return_date": best.get("return_date") if days else None}
    try:
        result, insights, url = check_route(one, api_key)
    except RuntimeError as e:
        result, insights, url = None, {}, None
        print(f"  ! 상세 조회 실패, 달력 가격만 기록: {e}")
    if not result:
        result = {"price": int(best["price"]), "airline": "(항공편 정보 없음)", "flight_number": "",
                  "depart_time": "", "arrive_time": "", "stops": None, "duration_min": None}
    result["flex_date"] = best["outbound_date"]
    if days:
        result["flex_return_date"] = best.get("return_date")
    result["calendar_price"] = int(best["price"])
    result["flex_top"] = [{"date": p["outbound_date"], "price": int(p["price"])} for p in prices[:5]]
    return result, insights, url


def check_route(route: dict, api_key: str) -> tuple[dict | None, dict, str | None]:
    """가는 편 검색 → (왕복이면) 그 가는 편으로 오는 편 검색. 가격은 항상 전체 인원 왕복/편도 총액."""
    if is_flex(route):
        return check_flex(route, api_key)
    if is_multi(route):
        return check_separate(route, api_key) if route.get("separate_tickets") else check_multi(route, api_key)
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


def stops_text(stops) -> str:
    return " 직항" if stops == 0 else (f" 경유 {stops}회" if stops else "")


def trip_text(route: dict) -> str:
    if is_flex(route):
        return flex_label(route["flex"])
    if is_multi(route):
        kind = " (구간별 편도 합산)" if route.get("separate_tickets") else " (다구간)"
        return " · ".join(f"{l['date']} {l['from'].upper()}→{l['to'].upper()}" for l in route["legs"]) + kind
    return f"{route['date']}" + (f" ~ {route['return_date']}" if route.get("return_date") else " 편도")


def flight_lines(e: dict) -> list[tuple[str, str]]:
    """(구분, 항공편 설명) 목록. 다구간은 구간별, 왕복은 가는 편/오는 편."""
    if e.get("legs"):
        return [(f"{i}구간 {l['date'][5:].replace('-', '/')} {l['from']}→{l['to']}",
                 f"{l['airline']} {l['flight_number']} {l['depart_time']} → {l['arrive_time']}{stops_text(l.get('stops'))}"
                 + (f" · {won(l['price'])}" if e.get("separate_tickets") and l.get("price") else ""))
                for i, l in enumerate(e["legs"], 1)]
    via = f"{e['dep_airport']}→{e['arr_airport']} " if e.get("dep_airport") and e.get("arr_airport") else ""
    if e.get("flex_date"):
        d = date.fromisoformat(e["flex_date"])
        when = f"{d.month}/{d.day}({WEEKDAY_KO[d.weekday()]})"
        if e.get("flex_return_date"):
            r = date.fromisoformat(e["flex_return_date"])
            when += f" ~ {r.month}/{r.day}({WEEKDAY_KO[r.weekday()]})"
        others = ", ".join(f"{date.fromisoformat(t['date']).month}/{date.fromisoformat(t['date']).day} {won(t['price'])}"
                           for t in (e.get("flex_top") or [])[1:4])
        flex_rows = [("가장 싼 날", when + (f"  (다음: {others})" if others else ""))]
    else:
        flex_rows = []
    rows = [("가는 편", f"{via}{e.get('airline')} {e.get('flight_number')} {e.get('depart_time')} → "
                       f"{e.get('arrive_time')}{stops_text(e.get('stops'))}")]
    rows = flex_rows + rows
    if e.get("return_airline"):
        rows.append(("오는 편", f"{e['return_airline']} {e['return_flight_number']} {e['return_depart_time']} → "
                               f"{e['return_arrive_time']}{stops_text(e.get('return_stops'))}"))
    return rows


def send_alert(route: dict, entry: dict, summary: dict, flights_url: str | None) -> None:
    user = os.environ.get("GMAIL_USER")
    pw = os.environ.get("GMAIL_APP_PASSWORD")
    to = os.environ.get("ALERT_EMAIL") or user
    if not (user and pw and to):
        print("  ! 메일 설정(GMAIL_USER / GMAIL_APP_PASSWORD)이 없어 알림을 건너뜁니다.")
        return
    is_low = summary["min"] == entry["price"]
    trip = trip_text(route)
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
    ] + [f"{k}: {v}" for k, v in flight_lines(entry)]
    lines += [
        "(1인 가격)" if route.get("adults", 1) == 1 else f"(성인 {route.get('adults', 1)}명 총액)",
        "",
        f"추적 기간 최저 {won(summary['min'])} · 평균 {won(summary['avg'])} · 최고 {won(summary['max'])}",
    ]
    links = compare_links(route)
    lines += [""]
    if flights_url:
        lines += [f"Google 항공권에서 보기: {flights_url}"]
    lines += [f"Kayak에서 비교: {links['kayak']}", f"Skyscanner에서 비교: {links['skyscanner']}"]
    if os.environ.get("SITE_URL"):
        lines += [f"가격 추이 그래프: {os.environ['SITE_URL'].rstrip('/')}/#{route['id']}"]
    msg.set_content("\n".join(lines))
    _smtp_send(msg, user, pw)
    print(f"  ✉ 알림 메일 발송 → {to}")


def _smtp_send(msg: EmailMessage, user: str, pw: str) -> None:
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
        s.login(user, pw)
        s.send_message(msg)


# ---------------------------------------------------------------- 정기 리포트 (하루 3번)

def _delta_text(cur: int | None, prev: int | None) -> str:
    if cur is None or prev is None:
        return "직전 기록 없음"
    d = cur - prev
    if d == 0:
        return "직전과 같음"
    return f"{'▼' if d < 0 else '▲'} {won(abs(d))} ({abs(d) / prev * 100:.1f}%)"


def build_report(items: list[dict], quota: dict | None, now: datetime, site_url: str | None) -> tuple[str, str, str]:
    """items: [{"route", "entry", "prev_price", "summary", "flights_url"}] → (제목, 본문, HTML)."""
    stamp = now.strftime("%m/%d %H:%M")
    ok = [i for i in items if i["entry"].get("price") is not None]
    if len(items) == 1 and ok:
        it = ok[0]
        subject = f"[항공권 {stamp}] {it['route']['name']} {won(it['entry']['price'])} · {_delta_text(it['entry']['price'], it['prev_price'])}"
    elif ok:
        subject = f"[항공권 {stamp}] 추적 노선 {len(items)}개 최저가"
    else:
        subject = f"[항공권 {stamp}] 조회 실패"

    text, html = [], []
    for it in items:
        r, e, sm = it["route"], it["entry"], it["summary"]
        trip = trip_text(r)
        pax = "1인 기준" if r.get("adults", 1) == 1 else f"성인 {r.get('adults', 1)}명 총액"
        links = compare_links({**r, "date": e.get("flex_date") or r["date"],
                               "return_date": e.get("flex_return_date") or r.get("return_date")})
        if e.get("price") is None:
            text += [f"■ {r['name']} ({r['from']} → {r['to']}, {trip})", f"  조회 실패: {e.get('error')}", ""]
            html.append(f"<h3 style='margin:18px 0 4px'>{escape(r['name'])}</h3>"
                        f"<p style='color:#a12828'>조회 실패: {escape(str(e.get('error')))}</p>")
            continue
        rows = flight_lines(e)
        delta = _delta_text(e["price"], it["prev_price"])
        text += [f"■ {r['name']} ({r['from']} → {r['to']}, {trip}, {pax})",
                 f"  최저가: {won(e['price'])}  ({delta})",
                 ] + [f"  {k}: {v}" for k, v in rows] + [
                 f"  추적 기간 최저 {won(sm['min'])} · 최고 {won(sm['max'])}"]
        if r.get("alert_below"):
            text.append(f"  목표가 {won(r['alert_below'])} " + ("도달" if e["price"] <= r["alert_below"] else "미도달"))
        plan = it.get("plan") or {}
        plan_txt = (f"다음 조회 {kst_label(plan.get('next_check'))}경 · 마지막 조회 {kst_label(plan.get('last_check'))}"
                    if plan.get("next_check") else "")
        if plan_txt:
            text.append(f"  {plan_txt}")
        if it.get("flights_url"):
            text.append(f"  Google 항공권: {it['flights_url']}")
        text += [f"  Kayak: {links['kayak']}", f"  Skyscanner: {links['skyscanner']}", ""]

        color = "#2a78d6" if (it["prev_price"] is not None and e["price"] < it["prev_price"]) else \
                "#e34948" if (it["prev_price"] is not None and e["price"] > it["prev_price"]) else "#8b909a"
        row = lambda k, v: f"<tr><td style='padding:3px 14px 3px 0;color:#666'>{k}</td><td>{v}</td></tr>"  # noqa: E731
        btn = lambda u, t: (f"<a href='{escape(u)}' style='display:inline-block;margin:0 6px 6px 0;padding:8px 12px;"  # noqa: E731
                            f"border-radius:10px;background:#f0f1f4;color:#111;text-decoration:none;font-size:13px'>{t}</a>")
        html.append(
            f"<div style='background:#fff;border:1px solid #e7e8ec;border-radius:14px;padding:16px;margin:12px 0'>"
            f"<div style='font-weight:700;font-size:16px'>{escape(r['name'])}</div>"
            f"<div style='color:#8b909a;font-size:13px'>{escape(r['from'])} → {escape(r['to'])} · {escape(trip)} · {pax}</div>"
            f"<div style='font-size:26px;font-weight:800;margin:10px 0 0'>{won(e['price'])}</div>"
            f"<div style='color:{color};font-size:13px;margin-bottom:10px'>{escape(delta)}</div>"
            f"<table style='font-size:14px;border-collapse:collapse'>"
            + "".join(row(escape(k), escape(v)) for k, v in rows)
            + row('추적 기간', f"최저 {won(sm['min'])} · 최고 {won(sm['max'])}")
            + (row('목표가', f"{won(r['alert_below'])} " + ('도달' if e['price'] <= r['alert_below'] else '미도달'))
               if r.get('alert_below') else "")
            + (row('다음 조회', f"{kst_label(plan.get('next_check'))}경 · 마지막 {kst_label(plan.get('last_check'))}")
               if plan.get("next_check") else "")
            + "</table><div style='margin-top:12px'>"
            + (btn(it["flights_url"], "Google 항공권") if it.get("flights_url") else "")
            + btn(links["kayak"], "Kayak 비교") + btn(links["skyscanner"], "Skyscanner 비교") + "</div></div>")

    if quota and quota.get("total_searches_left") is not None:
        q = f"SerpApi 남은 검색 {quota['total_searches_left']}회 · 갱신일 {quota.get('plan_renewal_date') or '-'}"
        text.append(q)
        html.append(f"<p style='color:#8b909a;font-size:12px'>{escape(q)}</p>")
    if site_url:
        text.append(f"가격 추이: {site_url.rstrip('/')}/")
        html.append(f"<p style='font-size:13px'><a href='{escape(site_url.rstrip('/'))}/'>가격 추이 보기</a></p>")
    header = f"{now.strftime('%Y-%m-%d %H:%M')} (한국시간) 조회 결과"
    body = header + "\n\n" + "\n".join(text)
    html_doc = (f"<div style='font-family:sans-serif;max-width:560px;color:#111'>"
                f"<p style='color:#4d525c'>{header}</p>{''.join(html)}</div>")
    return subject, body, html_doc


def send_report(items: list[dict], quota: dict | None, now: datetime) -> None:
    user = os.environ.get("GMAIL_USER")
    pw = os.environ.get("GMAIL_APP_PASSWORD")
    to = os.environ.get("ALERT_EMAIL") or user
    if not (user and pw and to):
        print("  ! 메일 설정(GMAIL_USER / GMAIL_APP_PASSWORD)이 없어 정기 리포트를 건너뜁니다.")
        return
    subject, body, html = build_report(items, quota, now, os.environ.get("SITE_URL"))
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, to
    msg.set_content(body)
    msg.add_alternative(html, subtype="html")
    _smtp_send(msg, user, pw)
    print(f"✉ 정기 리포트 발송 → {to}")


# ---------------------------------------------------------------- 조회 일정

WEEKDAYS = "월화수목금토일"


def schedule_times() -> list[str]:
    """워크플로의 예약 시각(한국시간). cron 과 맞춰 SCHEDULE_KST 에 "06:30,18:30" 처럼 넣습니다."""
    raw = os.environ.get("SCHEDULE_KST") or "06:30"
    return sorted({t.strip() for t in raw.split(",") if t.strip()}, key=parse_hm)


def check_plan(route: dict, status: str, now: datetime, times: list[str]) -> dict:
    """다음 조회 예정 시각과 마지막 조회 예정 시각. 출발일 당일까지 조회하고 그 뒤로는 멈춥니다."""
    if status != "active" or not times:
        return {"next_check": None, "last_check": None}
    last_day = date.fromisoformat(route["date"])
    at = lambda d, t: datetime(d.year, d.month, d.day, parse_hm(t) // 60, parse_hm(t) % 60, tzinfo=KST)  # noqa: E731
    nxt = None
    for offset in range(2):
        day = (now + timedelta(days=offset)).date()
        nxt = next((at(day, t) for t in times if at(day, t) > now), None)
        if nxt:
            break
    if nxt and nxt.date() > last_day:
        nxt = None
    return {"next_check": nxt.isoformat(timespec="minutes") if nxt else None,
            "last_check": at(last_day, times[-1]).isoformat(timespec="minutes")}


def should_skip_scheduled(last_scheduled_date: str | None, today: str) -> bool:
    """GitHub 예약 실행은 빠지기도 해서 같은 날 여러 번 예약해 두고, 그날 이미 성공했으면 나머지는 건너뜁니다."""
    return last_scheduled_date == today


def kst_label(iso: str | None) -> str:
    if not iso:
        return "-"
    d = datetime.fromisoformat(iso)
    return f"{d.month}/{d.day}({WEEKDAYS[d.weekday()]}) {d:%H:%M}"


# ---------------------------------------------------------------- 비교 사이트 링크

KAYAK_CABIN = {"economy": "", "premium_economy": "/premium", "business": "/business", "first": "/first"}
SKYSCANNER_CABIN = {"economy": "economy", "premium_economy": "premiumeconomy",
                    "business": "business", "first": "first"}


# 공항을 여러 개("ICN,GMP") 지정한 경우 비교 사이트에는 도시 코드로 넘김 (Kayak / Skyscanner)
METRO = [
    ({"ICN", "GMP"}, "SEL", "sela"),
    ({"KIX", "ITM", "UKB"}, "OSA", "osaa"),
    ({"HND", "NRT"}, "TYO", "tyoa"),
    ({"PVG", "SHA"}, "SHA", "csha"),
    ({"PEK", "PKX"}, "BJS", "bjsa"),
    ({"TPE", "TSA"}, "TPE", "tpet"),
]


REGION_SITES = {"KR": ("SEL", "kr"), "JP": ("TYO", "jp")}  # 나라 전체: Kayak 은 대표 도시, Skyscanner 는 나라 코드


def site_codes(codes: str) -> tuple[str, str]:
    """"ICN,GMP" → ("SEL", "sela"). 하나면 그 공항, 묶을 도시가 없으면 첫 공항."""
    items = [c.strip().upper() for c in codes.split(",") if c.strip()]
    for c in items:
        if c in REGION_SITES:
            return REGION_SITES[c]
    if len(items) <= 1:
        c = items[0] if items else ""
        return c, c.lower()
    for members, kayak, sky in METRO:
        if set(items) <= members:
            return kayak, sky
    return items[0], items[0].lower()


def compare_links(route: dict) -> dict:
    """같은 노선·날짜·인원·좌석으로 Kayak / Skyscanner 검색 결과를 여는 주소.
    출발 시간대 조건은 두 사이트 주소로 지정할 수 없어서 각 사이트에서 직접 거릅니다."""
    adults = int(route.get("adults", 1))
    cabin = route.get("travel_class", "economy")
    direct = route.get("max_stops") == 0
    query = "?" + urllib.parse.urlencode({
        "adultsv2": adults, "cabinclass": SKYSCANNER_CABIN.get(cabin, "economy"),
        "rtn": 1 if route.get("return_date") else 0, "preferdirects": "true" if direct else "false",
    })
    k_tail = KAYAK_CABIN.get(cabin, "") + (f"/{adults}adults" if adults > 1 else "") + \
        "?sort=price_a" + ("&fs=stops%3D0" if direct else "")
    if is_multi(route):
        legs = route["legs"]
        kayak = "https://www.kayak.co.kr/flights/" + "/".join(
            f"{l['from'].upper()}-{l['to'].upper()}/{l['date']}" for l in legs) + k_tail
        sky = "https://www.skyscanner.co.kr/transport/d/" + "/".join(
            f"{l['from'].lower()}/{l['date']}/{l['to'].lower()}" for l in legs) + "/" + query.replace("rtn=0", "rtn=2")
        return {"kayak": kayak, "skyscanner": sky}
    (org, sky_org), (dst, sky_dst) = site_codes(route["from"]), site_codes(route["to"])
    ret = route.get("return_date")

    kayak = f"https://www.kayak.co.kr/flights/{org}-{dst}/{route['date']}"
    if ret:
        kayak += f"/{ret}"
    kayak += k_tail

    yymmdd = lambda iso: iso[2:4] + iso[5:7] + iso[8:10]  # noqa: E731
    sky = f"https://www.skyscanner.co.kr/transport/flights/{sky_org}/{sky_dst}/{yymmdd(route['date'])}/"
    if ret:
        sky += f"{yymmdd(ret)}/"
    sky += query
    return {"kayak": kayak, "skyscanner": sky}


# ---------------------------------------------------------------- SerpApi 잔여 검색 수

# account.json 응답 중 공개 페이지에 써도 되는 항목만 남깁니다 (API 키·이메일 제외).
QUOTA_FIELDS = ("plan_name", "searches_per_month", "plan_searches_left", "extra_credits",
                "total_searches_left", "this_month_usage", "plan_renewal_date",
                "account_rate_limit_per_hour")


def searches_per_check(route: dict) -> int:
    """노선 1회 조회에 드는 검색 수. 왕복은 가는 편 + 오는 편 = 2회. 유연한 날짜는 가격 달력 1회 + 상세."""
    if is_flex(route):
        return 1 + (2 if route["flex"].get("trip_days") else 1)
    if is_multi(route):
        return len(route["legs"])
    return 2 if route.get("return_date") else 1


def fetch_quota(api_key: str) -> dict:
    """SerpApi Account API (검색 횟수에 포함되지 않음)."""
    url = "https://serpapi.com/account.json?" + urllib.parse.urlencode({"api_key": api_key})
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(data["error"])
    return {k: data.get(k) for k in QUOTA_FIELDS}


def build_quota(fetched: dict | None, previous: dict | None, daily_usage: int,
                checked_at: str, error: str | None = None) -> dict:
    """조회에 실패하면 이전 값을 유지하고 오류만 표시합니다."""
    base = dict(fetched) if fetched else {k: v for k, v in (previous or {}).items() if k in QUOTA_FIELDS}
    base["daily_usage"] = daily_usage
    if fetched:
        base["checked_at"] = checked_at
    else:
        base["checked_at"] = (previous or {}).get("checked_at")
        base["error"] = error
    return base


# ---------------------------------------------------------------- 메인

def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def changed_route_ids(routes_raw: list[dict]) -> set[str] | None:
    """직전 커밋의 routes.json 과 비교해 새로 생기거나 조건이 바뀐 노선 id. 비교할 수 없으면 None(전부 조회)."""
    try:
        prev = subprocess.run(["git", "show", "HEAD^:flight-tracker/routes.json"], cwd=ROOT.parent,
                              capture_output=True, text=True, check=True).stdout
        before = {r["id"]: r for r in json.loads(prev).get("routes", [])}
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError, KeyError):
        return None
    return {r["id"] for r in routes_raw if before.get(r["id"]) != r}


def run(dry_run: bool = False) -> int:
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key and not dry_run:
        print("SERPAPI_KEY 환경 변수가 없습니다.", file=sys.stderr)
        return 1
    routes_raw = load_json(ROUTES_FILE, {"routes": []})["routes"]
    routes = [normalize_route(r) for r in routes_raw]
    # 앱이나 GitHub 에서 노선을 바꿔 push 된 경우: 바뀐 노선만 조회 (검색 횟수 절약)
    only = changed_route_ids(routes_raw) if os.environ.get("ONLY_CHANGED") == "1" else None
    if only is not None:
        print(f"바뀐 노선만 조회: {sorted(only) or '없음'}")
    now = now_kst()
    today = now.date().isoformat()
    prev_index = load_json(DATA_DIR / "index.json", {})
    scheduled = os.environ.get("RUN_EVENT") == "schedule"
    if scheduled and should_skip_scheduled(prev_index.get("last_scheduled_date"), today):
        print(f"오늘({today}) 예약 조회를 이미 마쳤습니다. 재시도용 예약 실행이라 건너뜁니다.")
        return 0
    index = []
    failures = 0
    report_items = []
    times = schedule_times()

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
        if status == "active" and not dry_run and (only is None or rid in only):
            result, error, insights, url = None, None, {}, None
            try:
                result, insights, url = check_route(route, api_key)
            except Exception as e:  # noqa: BLE001 - 한 노선 실패가 전체를 멈추지 않게
                error = str(e).replace(api_key, "***")
                failures += 1
            prev_ok = [h for h in history if h.get("price") is not None]
            prev_price = prev_ok[-1]["price"] if prev_ok else None  # 직전 조회(오늘 이른 시각 포함)
            history = record_result(history, today, result, error, now.isoformat(timespec="seconds"), insights)
            doc["google_flights_url"] = url or doc.get("google_flights_url")
            print(f"  가격: {won(result['price']) if result else '없음'}" + (f" (오류: {error})" if error else ""))

            summary = summarize(history)
            report_items.append({
                "route": route, "summary": summary, "prev_price": prev_price,
                "plan": check_plan(route, status, now, times),
                "entry": {**(result or {}), "price": result["price"] if result else None,
                          "error": error or (None if result else "조건에 맞는 항공편 없음")},
                "flights_url": doc.get("google_flights_url"),
            })
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
        doc.update(check_plan(route, status, now, times))
        doc["schedule_kst"] = times
        save_json(path, doc)
        index.append({
            "id": rid, "name": route["name"], "from": route["from"], "to": route["to"],
            "date": route["date"], "return_date": route.get("return_date"), "legs": route.get("legs"),
            "flex": route.get("flex"),
            "alert_below": route.get("alert_below"), "status": status,
            "summary": doc["summary"], "next_check": doc["next_check"], "last_check": doc["last_check"],
            "spark": [h["price"] for h in history if h.get("price") is not None][-30:],
            "spark_dates": [h["date"] for h in history if h.get("price") is not None][-30:],
        })

    runs_per_day = int(os.environ.get("RUNS_PER_DAY") or 1)
    daily_usage = runs_per_day * sum(searches_per_check(r) for r, i in zip(routes, index) if i["status"] == "active")
    fetched, qerr = None, None
    if api_key:
        try:
            fetched = fetch_quota(api_key)
            print(f"- SerpApi 남은 검색: {fetched.get('total_searches_left')}회, 갱신일 {fetched.get('plan_renewal_date')}")
        except Exception as e:  # noqa: BLE001
            qerr = str(e).replace(api_key, "***")
            print(f"  ! 잔여 검색 수 조회 실패: {qerr}", file=sys.stderr)
    else:
        qerr = "SERPAPI_KEY 없음"
    quota = build_quota(fetched, prev_index.get("quota"), daily_usage, now.isoformat(timespec="seconds"), qerr)

    save_json(DATA_DIR / "index.json", {"updated_at": now.isoformat(timespec="seconds"), "routes": index,
                                        "quota": quota, "schedule_kst": times,
                                        "last_scheduled_date": today if scheduled else prev_index.get("last_scheduled_date")})

    if report_items and os.environ.get("SEND_REPORT", "").lower() == "true":
        try:
            send_report(report_items, quota, now)
        except Exception as e:  # noqa: BLE001
            print(f"! 정기 리포트 발송 실패: {e}", file=sys.stderr)
    # 모든 노선이 실패했을 때만 실패 코드 → GitHub Actions 에서 빨간불로 보임
    active = sum(1 for r in index if r["status"] == "active")
    return 1 if active and failures == active else 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="API 호출 없이 index.json 만 다시 만듭니다")
    sys.exit(run(dry_run=p.parse_args().dry_run))
