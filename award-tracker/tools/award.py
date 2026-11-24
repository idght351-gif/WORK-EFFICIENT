#!/usr/bin/env python3
"""마일 좌석 추적 도구 — 집 PC 의 Claude 가 조회하면서 쓰는 명령 모음 (파이썬 표준 라이브러리만 사용).

  python award-tracker/tools/award.py start                  조회 시작: 노선 설정 반영 + 이번에 검색할 목록
  python award-tracker/tools/award.py plan                   검색할 목록 다시 보기
  python award-tracker/tools/award.py wait click|search|between   천천히: 정해 둔 범위에서 무작위로 기다림
  python award-tracker/tools/award.py save 결과.json           읽은 결과를 앱 데이터에 합침 (- 를 주면 표준입력)
  python award-tracker/tools/award.py finish ok|login_required|challenge|error [--message 글]
  python award-tracker/tools/award.py publish                앱 데이터만 commit · push
  python award-tracker/tools/award.py sync                   노선 설정(routes.json)만 앱 데이터에 반영
  python award-tracker/tools/award.py send-alerts [--dry-run]  (GitHub Actions) 알림 메일
"""
from __future__ import annotations

import argparse
import calendar
import json
import os
import random
import smtplib
import ssl
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

KST = timezone(timedelta(hours=9))
CABINS = {"economy": "이코노미", "business": "비즈니스"}
DIRS = {"out": "가는 편", "back": "오는 편"}
STATUSES = {"ok": "정상", "login_required": "로그인 필요", "challenge": "보안 확인 필요", "error": "조회 실패"}
DOW = "월화수목금토일"
DEFAULT_SETTINGS = {
    "airfrance_url": None,
    "max_searches_per_run": 40,
    "max_details_per_route": 4,
    "detail_within_pct": 0,       # 목표 마일이 없을 때: 그 달 최저 마일 + 이 % 이내 날짜를 상세 확인 (0 = 최저만)
    "search_open_months": False,
    "search_cabins": None,        # 예 ["economy"]: 캘린더 검색은 이 등급만. 다른 등급은 상세 확인 때 같은 편 목록에서 읽어 detail 로 저장  # True 면 노선 기간 끝을 무시하고, 시작 달부터 예약이 열린 달(오늘 + 355일)까지 모두 검색
    "wait_seconds": {"click": [8, 15], "search": [20, 35], "between": [40, 80]},
    "run_at_kst": None,
}
FRESH = timedelta(hours=48)
MAX_MONTHS = 8  # 노선 한 방향 기간은 최대 8개월 (앱 site/app.js 와 같은 값)
BOOKABLE_DAYS = 355  # 발권은 보통 약 1년 전부터 열림 (앱 site/app.js 와 같은 값)


class AwardError(Exception):
    """사용자(또는 Claude)에게 그대로 보여줄 오류."""


class Paths:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.routes = self.root / "routes.json"
        self.data = self.root / "site" / "data"
        self.index = self.data / "index.json"
        self.route_dir = self.data / "routes"
        self.alerts = self.data / "alerts.json"

    def route_file(self, rid: str) -> Path:
        return self.route_dir / f"{rid}.json"


def default_paths() -> Paths:
    return Paths(Path(os.environ.get("AWARD_ROOT") or Path(__file__).resolve().parents[1]))


# ------------------------------------------------------------ 작은 도우미
def now() -> datetime:
    v = os.environ.get("AWARD_NOW")
    return datetime.fromisoformat(v) if v else datetime.now(KST)


def ts(dt: datetime) -> str:
    return dt.astimezone(KST).isoformat(timespec="seconds")


def read_json(p: Path, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json(p: Path, obj) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(p)


def md(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.month}/{d.day}({DOW[d.weekday()]})"


def num(n) -> str:
    return "-" if n is None else f"{n:,}"


def to_int(v):
    """15000, "15,000", "15,000 마일", "-" 처럼 읽은 그대로 넣어도 숫자로 바꿈. 좌석 없음은 None."""
    if v is None:
        return None
    if isinstance(v, bool):
        raise AwardError(f"숫자가 와야 하는 자리에 {v!r} 가 왔어요")
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).replace(",", "").replace("마일", "").replace("miles", "").replace("원", "").replace("KRW", "").strip()
    if s in ("", "-", "–", "—", "없음", "none", "None", "null"):
        return None
    try:
        return int(float(s))
    except ValueError:
        raise AwardError(f"숫자로 읽을 수 없어요: {v!r}") from None


def money(v):
    if v is None:
        return None
    if isinstance(v, dict):
        amount, currency = to_int(v.get("amount")), (v.get("currency") or "KRW").upper()
    else:
        amount, currency = to_int(v), "KRW"
    return None if amount is None else {"amount": amount, "currency": currency}


def money_text(t) -> str:
    if not t:
        return ""
    return f"{t['amount']:,}원" if t.get("currency", "KRW") == "KRW" else f"{t['amount']:,} {t['currency']}"


# ------------------------------------------------------------ 노선 설정
def validate_route(r: dict) -> None:
    rid = r.get("id", "?")
    miss = [k for k in ("id", "from", "to", "start", "end", "cabins") if not r.get(k)]
    if miss:
        raise AwardError(f"노선 {rid} 에 {', '.join(miss)} 가 없어요")
    for k in ("start", "end", "return_start", "return_end"):
        if r.get(k):
            try:
                date.fromisoformat(r[k])
            except ValueError:
                raise AwardError(f"노선 {rid} 의 {k} 날짜 형식이 이상해요: {r[k]}") from None
    if r["end"] < r["start"]:
        raise AwardError(f"노선 {rid} 의 가는 편 기간 끝이 시작보다 빨라요")
    if bool(r.get("return_start")) != bool(r.get("return_end")):
        raise AwardError(f"노선 {rid} 의 오는 편 기간은 시작과 끝을 같이 적어 주세요")
    for a, b, label in ((r["start"], r["end"], "가는 편"), (r.get("return_start"), r.get("return_end"), "오는 편")):
        if a and b and len(months(a, b)) > MAX_MONTHS:
            raise AwardError(f"노선 {rid} 의 {label} 기간이 {len(months(a, b))}개월이에요. 최대 {MAX_MONTHS}개월(예: 2월~9월)까지 정해 주세요")
    bad = [c for c in r["cabins"] if c not in CABINS]
    if bad:
        raise AwardError(f"노선 {rid} 의 좌석 등급을 알 수 없어요: {', '.join(bad)} (economy / business)")


def load_config(P: Paths):
    cfg = read_json(P.routes, {}) or {}
    s = {**DEFAULT_SETTINGS, **(cfg.get("settings") or {})}
    s["wait_seconds"] = {**DEFAULT_SETTINGS["wait_seconds"], **(s.get("wait_seconds") or {})}
    routes = cfg.get("routes") or []
    seen = set()
    for r in routes:
        validate_route(r)
        if r["id"] in seen:
            raise AwardError(f"routes.json 에 같은 id 가 두 번 있어요: {r['id']}")
        seen.add(r["id"])
    if s.get("search_open_months"):
        horizon = (now().astimezone(KST).date() + timedelta(days=BOOKABLE_DAYS)).isoformat()
        routes = [{**r, "end": max(r["end"], horizon),
                   **({"return_end": max(r["return_end"], horizon)} if r.get("return_end") else {})} for r in routes]
    return s, routes


def spans(r: dict):
    out = [("out", r["from"], r["to"], r["start"], r["end"])]
    if r.get("return_start"):
        out.append(("back", r["to"], r["from"], r["return_start"], r["return_end"]))
    return out


def months(a: str, b: str):
    s, e = date.fromisoformat(a), date.fromisoformat(b)
    y, m, res = s.year, s.month, []
    while (y, m) <= (e.year, e.month):
        res.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return res


def public_settings(s: dict) -> dict:
    return {k: s[k] for k in ("max_searches_per_run", "max_details_per_route", "run_at_kst", "wait_seconds")}


def next_run(s: dict):
    t = s.get("run_at_kst")
    if not t:
        return None
    h, m = map(int, t.split(":"))
    n = now().astimezone(KST)
    cand = n.replace(hour=h, minute=m, second=0, microsecond=0)
    return ts(cand if cand > n else cand + timedelta(days=1))


# ------------------------------------------------------------ 노선 데이터 · 요약
def load_doc(P: Paths, r: dict) -> dict:
    doc = read_json(P.route_file(r["id"]), {}) or {}
    old = doc.get("directions") or {}
    dirs = {}
    for key, f, t, _a, _b in spans(r):
        dirs[key] = {"from": f, "to": t, "days": (old.get(key) or {}).get("days") or {}}
    return {"route": r, "updated_at": doc.get("updated_at"), "directions": dirs}


def summarize(days: dict, a: str, b: str, cabin: str, target, ref) -> dict:
    s = {"min": None, "min_date": None, "hit": 0, "avail": 0, "checked": 0, "fresh": 0}
    for iso in sorted(days):
        e = days[iso].get(cabin)
        if not (a <= iso <= b) or e is None:
            continue
        s["checked"] += 1
        m = e.get("miles")
        if m is None:
            continue
        s["avail"] += 1
        if s["min"] is None or m < s["min"]:
            s["min"], s["min_date"] = m, iso
        if target and m <= target:
            s["hit"] += 1
        if ref and e.get("first_seen") and (not target or m <= target):
            if ref - datetime.fromisoformat(e["first_seen"]) <= FRESH:
                s["fresh"] += 1
    return s


def route_summary(doc: dict) -> dict:
    r = doc["route"]
    ref = datetime.fromisoformat(doc["updated_at"]) if doc.get("updated_at") else None
    out = {}
    for key, _f, _t, a, b in spans(r):
        days = doc["directions"][key]["days"]
        out[key] = {c: summarize(days, a, b, c, (r.get("target_miles") or {}).get(c), ref) for c in r["cabins"]}
    return out


def build_index(P: Paths, settings: dict, routes: list, runner: dict | None = None) -> dict:
    old = read_json(P.index, {}) or {}
    if runner is None:
        runner = old.get("runner") if not old.get("sample") else None
    items = []
    for r in routes:
        doc = load_doc(P, r)
        items.append({**r, "summary": route_summary(doc), "last_checked_at": doc.get("updated_at")})
    idx = {
        "sample": False,
        "updated_at": ts(now()),
        "settings": public_settings(settings),
        "runner": runner or {"status": "never"},
        "routes": items,
    }
    write_json(P.index, idx)
    return idx


def sync(P: Paths):
    settings, routes = load_config(P)
    old = read_json(P.index, {}) or {}
    if old.get("sample"):
        # 화면 확인용 샘플 데이터는 첫 실제 조회 때 모두 지움 (같은 id 의 노선이 있어도 섞이지 않게)
        for r in old.get("routes") or []:
            if r.get("id"):
                P.route_file(r["id"]).unlink(missing_ok=True)
    for r in routes:
        doc = load_doc(P, r)
        write_json(P.route_file(r["id"]), doc)
    build_index(P, settings, routes)
    return settings, routes


# ------------------------------------------------------------ 이번 조회 목록
def make_plan(P: Paths, settings: dict, routes: list):
    today = now().astimezone(KST).date().isoformat()
    items = []
    for order, r in enumerate(routes):
        if r.get("active") is False:
            continue
        doc = load_doc(P, r)
        for key, f, t, a, b in spans(r):
            if b < today:
                continue
            a2 = max(a, today)
            for c in CABINS:
                if c not in r["cabins"] or (settings.get("search_cabins") and c not in settings["search_cabins"]):
                    continue
                for m in months(a2, b):
                    # 그 달(기간 안)에서 가장 오래전에 확인한 때. 한 번도 안 본 날이 있으면 맨 앞.
                    y, mo = map(int, m.split("-"))
                    lo, hi = max(a2, m + "-01"), min(b, f"{m}-{calendar.monthrange(y, mo)[1]:02d}")
                    d, last = date.fromisoformat(lo), ""
                    while d.isoformat() <= hi:
                        e = doc["directions"][key]["days"].get(d.isoformat(), {}).get(c)
                        if e is None:
                            last = ""
                            break
                        last = e["checked_at"] if not last else min(last, e["checked_at"])
                        d += timedelta(days=1)
                    items.append({
                        "route_id": r["id"], "name": r.get("name") or f"{r['from']} → {r['to']}",
                        "direction": key, "from": f, "to": t, "cabin": c, "month": m,
                        "period": [lo, hi], "nonstop": bool(r.get("nonstop")), "_last": last, "_order": order,
                    })
    items.sort(key=lambda x: (x["_last"], x["_order"]))
    for x in items:
        x.pop("_order")
        x["last_checked"] = x.pop("_last") or None
    limit = settings["max_searches_per_run"]
    return items[:limit], items[limit:]


def minutes_estimate(settings: dict, n: int) -> int:
    w = settings["wait_seconds"]
    avg = lambda k: sum(w[k]) / 2  # noqa: E731
    per = 6 * avg("click") + avg("search") + avg("between") + 60  # 클릭 6번 + 결과 기다림 + 다음 검색 전 + 읽기
    return round(n * per / 60)


def print_plan(settings: dict, planned: list, postponed: list) -> None:
    if not planned:
        print("이번에 검색할 것이 없어요 (켜 둔 노선이 없거나 기간이 모두 지났어요).")
        return
    print(f"이번 조회: 캘린더 검색 {len(planned)}회 · 예상 약 {minutes_estimate(settings, len(planned))}분 (상세 확인 제외)")
    for i, x in enumerate(planned, 1):
        seen = f"마지막 확인 {x['last_checked'][5:16].replace('T', ' ')}" if x["last_checked"] else "처음"
        print(f"{i:>2}. {x['from']}→{x['to']} {CABINS[x['cabin']]} {x['month']} {'직항만' if x['nonstop'] else '직항·경유 모두'}  "
              f"[{x['route_id']} · {DIRS[x['direction']]} · 기간 {x['period'][0]}~{x['period'][1]} · {seen}]")
    if postponed:
        print(f"한 번에 최대 {settings['max_searches_per_run']}회라서 {len(postponed)}개는 다음 조회로 미뤄요 (오래된 것부터 먼저 해요).")


# ------------------------------------------------------------ 결과 합치기
def clean_flight(f: dict) -> dict:
    out = {
        "no": str(f.get("no") or f.get("flight") or "").replace(" ", "").upper() or None,
        "from": (f.get("from") or "").upper() or None, "to": (f.get("to") or "").upper() or None,
        "dep": f.get("dep"), "arr": f.get("arr"),
        "stops": to_int(f.get("stops")), "via": f.get("via") or None,
        "miles": to_int(f.get("miles")), "tax": money(f.get("tax")),
        "operated_by": f.get("operated_by"),
    }
    return {k: v for k, v in out.items() if v is not None}


def merge_days(days: dict, new_days: dict, cabin: str, source: str, checked: str, target, a: str, b: str) -> dict:
    res = {"saved": [], "skipped": [], "alerts": []}
    for iso in sorted(new_days):
        try:
            date.fromisoformat(iso)
        except ValueError:
            raise AwardError(f"날짜 형식이 이상해요: {iso} (예: 2027-06-21)") from None
        if not (a <= iso <= b):
            res["skipped"].append(iso)
            continue
        val = new_days[iso]
        if not isinstance(val, dict):
            val = {"miles": val}
        flights = [clean_flight(f) for f in (val.get("flights") or [])]
        miles = to_int(val.get("miles"))
        if miles is None and flights:
            fm = [f["miles"] for f in flights if f.get("miles") is not None]
            miles = min(fm) if fm else None
        old = days.get(iso, {}).get(cabin)
        old_m = old.get("miles") if old else None
        e = {"miles": miles, "checked_at": checked, "source": source}
        if miles is not None:
            e["first_seen"] = old["first_seen"] if old_m is not None and old.get("first_seen") else checked
            if old_m is not None and old_m != miles:
                e["prev_miles"] = old_m
            elif old_m == miles and old.get("prev_miles") is not None:
                e["prev_miles"] = old["prev_miles"]
            if source == "detail":
                tax = money(val.get("tax"))
                if tax is None and flights:
                    cheapest = min(flights, key=lambda f: f.get("miles") if f.get("miles") is not None else 10**9)
                    tax = cheapest.get("tax")
                if tax:
                    e["tax"] = tax
                raw_seats = val.get("seats")
                if isinstance(raw_seats, str) and raw_seats.strip().endswith("+"):
                    seats = f"{to_int(raw_seats.strip()[:-1])}+"  # "2+" = 1석 경고가 없어 2석 이상
                else:
                    seats = to_int(raw_seats)
                if seats is not None:
                    e["seats"] = seats
                if flights:
                    e["flights"] = flights
                e["detail_checked_at"] = checked
            elif old_m == miles:
                for k in ("tax", "seats", "flights", "detail_checked_at"):
                    if old.get(k) is not None:
                        e[k] = old[k]
        days.setdefault(iso, {})[cabin] = e
        res["saved"].append(iso)
        if target and miles is not None and miles <= target and (old_m is None or old_m > target or miles < old_m):
            res["alerts"].append({
                "date": iso, "miles": miles, "prev_miles": old_m, "tax": e.get("tax"),
                "kind": "new" if old_m is None or old_m > target else "cheaper",
            })
    return res


def new_run() -> dict:
    return {"run_id": ts(now()), "status": "running", "started_at": ts(now()), "finished_at": None,
            "message": None, "searches": 0, "details": {}, "alerts": []}


def save_items(P: Paths, items) -> list[str]:
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list) or not items:
        raise AwardError("저장할 결과가 비어 있어요")
    settings, routes = load_config(P)
    by_id = {r["id"]: r for r in routes}
    run = read_json(P.alerts) or {}
    running = run.get("status") == "running"
    docs, reports = {}, []
    for it in items:
        r = by_id.get(it.get("route_id"))
        if not r:
            raise AwardError(f"routes.json 에 없는 노선이에요: {it.get('route_id')}")
        sp = {s[0]: s for s in spans(r)}
        key = it.get("direction", "out")
        if key not in sp:
            raise AwardError(f"{r['id']} 에는 '{key}' 방향이 없어요 (out / back)")
        cabin = it.get("cabin")
        if cabin not in r["cabins"]:
            raise AwardError(f"{r['id']} 에서 추적하지 않는 좌석 등급이에요: {cabin}")
        source = it.get("source", "calendar")
        if source not in ("calendar", "detail"):
            raise AwardError("source 는 calendar 또는 detail 이에요")
        checked = it.get("checked_at") or ts(now())
        doc = docs.setdefault(r["id"], load_doc(P, r))
        _k, f, t, a, b = sp[key]
        days = doc["directions"][key]["days"]
        target = (r.get("target_miles") or {}).get(cabin)
        first = not any(cabin in d for iso, d in days.items() if a <= iso <= b)
        res = merge_days(days, it.get("days") or {}, cabin, source, checked, target, a, b)
        doc["updated_at"] = max(doc.get("updated_at") or "", checked)

        label = f"{f}→{t} {CABINS[cabin]} {DIRS[key]}"
        if running:
            run["searches"] += 1
            if source == "detail":
                run["details"][r["id"]] = run["details"].get(r["id"], 0) + len(res["saved"])
            alerts = run["alerts"]
            for al in res["alerts"]:
                al.update({"route_id": r["id"], "name": r.get("name") or label, "direction": key,
                           "from": f, "to": t, "cabin": cabin, "kind": "first" if first else al["kind"]})
                alerts[:] = [x for x in alerts if (x["route_id"], x["direction"], x["cabin"], x["date"]) != (r["id"], key, cabin, al["date"])]
                alerts.append(al)
            # 상세 확인으로 세금을 알게 되면 이번 알림에도 넣음
            for x in alerts:
                if (x["route_id"], x["direction"], x["cabin"]) == (r["id"], key, cabin) and x["date"] in res["saved"]:
                    e = days[x["date"]][cabin]
                    if e.get("miles") is not None:
                        x["miles"], x["tax"] = e["miles"], e.get("tax")
                        x["flights"] = [fl.get("no") for fl in e.get("flights", []) if fl.get("no")]

        s = summarize(days, a, b, cabin, target, None)
        saved = [d for d in res["saved"]]
        found = [d for d in saved if days[d][cabin].get("miles") is not None]
        line = f"✓ 저장 {label} ({r['id']}): {len(saved)}일"
        if source == "calendar":
            line += f" 중 좌석 {len(found)}일"
            mins = [days[d][cabin]["miles"] for d in found]
            if mins:
                low = min(mins)
                line += f", 최저 {num(low)}마일 ({', '.join(md(d) for d in found if days[d][cabin]['miles'] == low)[:60]})"
        else:
            line += " 상세 · " + ", ".join(
                f"{md(d)} {num(days[d][cabin].get('miles'))}마일" + (f" + {money_text(days[d][cabin].get('tax'))}" if days[d][cabin].get("tax") else "")
                for d in saved)
        if target:
            line += f" · 기간 전체 목표 {num(target)} 이하 {s['hit']}일"
        if res["alerts"]:
            line += f" · 새로 열림/더 싸짐 {len(res['alerts'])}일"
        if res["skipped"]:
            line += f" · 기간 밖 {len(res['skipped'])}일은 건너뜀"
        reports.append(line)

        if source == "calendar" and found:
            used = run.get("details", {}).get(r["id"], 0) if running else 0
            left = max(0, settings["max_details_per_route"] - used)
            new_dates = {al["date"] for al in res["alerts"]}
            if target:
                # 목표 이하인 날 중 새로 열렸거나 세금을 아직 모르는 날
                cands = [d for d in found if days[d][cabin]["miles"] <= target
                         and (d in new_dates or not days[d][cabin].get("tax"))]
            else:
                # 목표가 없으면: 이번에 본 날 중 최저 마일 + detail_within_pct % 이내인 날 (세금을 아직 모르는 날)
                low = min(days[d][cabin]["miles"] for d in found)
                limit = low * (100 + (settings.get("detail_within_pct") or 0)) / 100
                cands = [d for d in found if days[d][cabin]["miles"] <= limit and not days[d][cabin].get("tax")]
            cands.sort(key=lambda d: (d not in new_dates, days[d][cabin]["miles"], d))
            if cands and left:
                reports.append(f"  → 상세 확인 추천 (남은 {left}개): " + ", ".join(md(d) for d in cands[:left]))
            elif cands:
                reports.append("  → 상세 확인할 날짜가 있지만 이 노선의 상세 확인 횟수를 다 썼어요 (다음 조회 때 확인)")

    for doc in docs.values():
        write_json(P.route_file(doc["route"]["id"]), doc)
    if running:
        write_json(P.alerts, run)
    build_index(P, settings, routes)
    return reports


# ------------------------------------------------------------ 시작 · 끝
def start(P: Paths):
    settings, routes = sync(P)
    write_json(P.alerts, new_run())
    old = read_json(P.index, {}) or {}
    runner = {**(old.get("runner") or {}), "status": "running", "started_at": ts(now()), "message": None}
    build_index(P, settings, routes, runner)
    planned, postponed = make_plan(P, settings, routes)
    return settings, planned, postponed


def finish(P: Paths, status: str, message: str | None = None) -> dict:
    if status not in STATUSES:
        raise AwardError(f"상태는 {', '.join(STATUSES)} 중 하나예요")
    settings, routes = load_config(P)
    run = read_json(P.alerts) or new_run()
    run.update({"status": status, "finished_at": ts(now()), "message": message})
    write_json(P.alerts, run)
    runner = {
        "status": status, "last_run_at": ts(now()), "next_run_at": next_run(settings), "message": message,
        "searches": run.get("searches", 0), "max_searches": settings["max_searches_per_run"],
    }
    build_index(P, settings, routes, runner)
    return run


def alert_lines(run: dict, site_url: str | None = None) -> list[str]:
    lines, groups = [], {}
    for a in run.get("alerts") or []:
        groups.setdefault((a["route_id"], a["direction"], a["cabin"]), []).append(a)
    for (rid, key, cabin), al in groups.items():
        al.sort(key=lambda x: x["date"])
        lines.append(f"■ {al[0]['name']} · {DIRS[key]} {al[0]['from']}→{al[0]['to']} · {CABINS[cabin]}")
        if all(x["kind"] == "first" for x in al):
            lines.append(f"  처음 조회 · 목표 이하 {len(al)}일: " + ", ".join(f"{md(x['date'])} {num(x['miles'])}" for x in al))
        else:
            for x in al:
                why = "새로 열림" if x["kind"] in ("new", "first") else f"더 싸짐 ({num(x['prev_miles'])} → {num(x['miles'])})"
                tax = f" + {money_text(x['tax'])}" if x.get("tax") else " (세금 확인 전)"
                fl = f" · {', '.join(x['flights'])}" if x.get("flights") else ""
                lines.append(f"  {md(x['date'])} {num(x['miles'])}마일{tax} · {why}{fl}")
        if site_url:
            lines.append(f"  달력 보기: {site_url.rstrip('/')}/#r/{rid}")
        lines.append("")
    return lines


def build_alert_mail(run: dict, site_url: str | None):
    status = run.get("status")
    if status in (None, "running"):
        return None
    alerts = run.get("alerts") or []
    problem = status != "ok"
    if not alerts and not problem:
        return None
    parts = []
    if problem:
        parts.append(STATUSES.get(status, status))
    if alerts:
        parts.append(f"목표 이하 {len(alerts)}건")
    subject = "[마일 좌석] " + " · ".join(parts)
    lines = []
    if problem:
        what = {
            "login_required": "에어프랑스 로그인이 풀려 있어서 조회를 멈췄어요. 집 PC 크롬에서 다시 로그인한 뒤 조회를 다시 시작해 주세요.",
            "challenge": "보안 확인(캡차) 화면이 나와서 조회를 멈췄어요. 집 PC 크롬에서 직접 확인해 주세요.",
            "error": "조회 중 문제가 생겨 멈췄어요.",
        }[status]
        lines += [what]
        if run.get("message"):
            lines += [f"메모: {run['message']}"]
        lines += [""]
    if alerts:
        lines += ["목표 마일 이하로 새로 열렸거나 더 싸진 좌석이에요.", ""] + alert_lines(run, site_url)
    lines += [f"조회: {run.get('started_at', '')[:16].replace('T', ' ')} 시작 · 검색 {run.get('searches', 0)}회"]
    if site_url:
        lines += [f"앱: {site_url}"]
    return subject, "\n".join(lines)


def send_alerts(P: Paths, dry_run: bool = False) -> str:
    run = read_json(P.alerts)
    if not run:
        return "알림 파일이 없어요."
    mail = build_alert_mail(run, os.environ.get("SITE_URL"))
    if not mail:
        return "보낼 알림이 없어요 (새로 열린 목표 이하 좌석 없음, 조회 정상)."
    subject, body = mail
    user, pw = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    to = os.environ.get("ALERT_EMAIL") or user
    if dry_run or not (user and pw and to):
        why = "미리 보기" if dry_run else "메일 설정(GMAIL_USER / GMAIL_APP_PASSWORD)이 없어 보내지 않음"
        return f"[{why}]\n제목: {subject}\n\n{body}"
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, to
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
        s.login(user, pw)
        s.send_message(msg)
    return f"알림 메일을 보냈어요: {subject}"


def publish(P: Paths) -> str:
    repo = P.root.parent
    rel = P.data.relative_to(repo).as_posix()
    git = lambda *a: subprocess.run(["git", *a], cwd=repo, capture_output=True, text=True, encoding="utf-8")  # noqa: E731
    git("add", rel)
    if git("diff", "--cached", "--quiet").returncode == 0:
        return "올릴 변경이 없어요."
    stamp = now().astimezone(KST).strftime("%Y-%m-%d %H:%M")
    c = git("commit", "-m", f"마일 좌석 조회 {stamp}")
    if c.returncode != 0:
        raise AwardError("commit 실패:\n" + c.stdout + c.stderr)
    for i in range(3):
        p = git("pull", "--rebase", "--autostash")
        q = git("push") if p.returncode == 0 else p
        if q.returncode == 0:
            return f"앱 데이터를 올렸어요 ({stamp}). 1~2분 뒤 휴대폰 앱에 반영돼요."
        time.sleep(5 * (i + 1))
    raise AwardError("push 실패 (다시 시도해 주세요):\n" + q.stdout + q.stderr)


def wait(settings: dict, kind: str) -> float:
    if kind not in settings["wait_seconds"]:
        raise AwardError(f"기다림 종류는 {', '.join(settings['wait_seconds'])} 중 하나예요")
    lo, hi = settings["wait_seconds"][kind]
    sec = round(random.uniform(lo, hi), 1)
    time.sleep(sec)
    return sec


# ------------------------------------------------------------ 명령줄
def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="마일 좌석 추적 도구")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("start")
    sub.add_parser("plan")
    sub.add_parser("sync")
    w = sub.add_parser("wait")
    w.add_argument("kind", choices=["click", "search", "between"])
    s = sub.add_parser("save")
    s.add_argument("file", help="결과 JSON 파일 (- 는 표준입력)")
    f = sub.add_parser("finish")
    f.add_argument("status", choices=list(STATUSES))
    f.add_argument("--message")
    sub.add_parser("publish")
    a = sub.add_parser("send-alerts")
    a.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    P = default_paths()
    try:
        if args.cmd == "start":
            settings, planned, postponed = start(P)
            print_plan(settings, planned, postponed)
        elif args.cmd == "plan":
            settings, routes = load_config(P)
            print_plan(settings, *make_plan(P, settings, routes))
        elif args.cmd == "sync":
            _s, routes = sync(P)
            print(f"노선 {len(routes)}개를 앱 데이터에 반영했어요.")
        elif args.cmd == "wait":
            settings, _r = load_config(P)
            print(f"{wait(settings, args.kind)}초 기다렸어요.")
        elif args.cmd == "save":
            text = sys.stdin.read() if args.file == "-" else Path(args.file).read_text(encoding="utf-8")
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as e:
                raise AwardError(f"결과 JSON 을 읽을 수 없어요: {e}") from None
            print("\n".join(save_items(P, payload)))
        elif args.cmd == "finish":
            run = finish(P, args.status, args.message)
            print(f"조회 끝 ({STATUSES[args.status]}) · 검색 {run.get('searches', 0)}회 · 알림 {len(run.get('alerts') or [])}건")
            lines = alert_lines(run)
            if lines:
                print("\n".join(lines).rstrip())
        elif args.cmd == "publish":
            print(publish(P))
        elif args.cmd == "send-alerts":
            print(send_alerts(P, args.dry_run))
    except AwardError as e:
        print(f"⚠ {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
