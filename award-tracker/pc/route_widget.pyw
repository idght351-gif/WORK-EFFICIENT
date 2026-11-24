"""마일 좌석 조회 노선 위젯 (PC 용).

한국 출발 도시 · 일본 도시 · 검색 기간(년월 ~ 년월)을 고르면 routes.json 에 왕복 노선을 넣고
GitHub 에 올려요. "지금 조회 시작" 은 바탕화면 버튼(award-search.cmd)과 같아요.
실행: award-tracker/pc/route-widget.cmd 더블클릭 (또는 pythonw route_widget.pyw)
"""
import calendar
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

PC = Path(__file__).resolve().parent
TRACKER = PC.parent
REPO = TRACKER.parent
ROUTES = TRACKER / "routes.json"
MAX_MONTHS = 8          # tools/award.py · site/app.js 와 같은 값
BOOKABLE_DAYS = 355

CITY = {
    "SEL": "서울 (인천·김포)", "PUS": "부산",
    "TYO": "도쿄 (나리타·하네다)", "OSA": "오사카·고베 (간사이·이타미·고베)", "NGO": "나고야", "FUK": "후쿠오카",
    "CTS": "삿포로", "OKA": "오키나와", "KOJ": "가고시마", "KMJ": "구마모토", "NGS": "나가사키", "OIT": "오이타",
    "KMQ": "고마쓰", "KIJ": "니가타", "SDJ": "센다이", "OKJ": "오카야마", "AOJ": "아오모리", "HIJ": "히로시마",
}
CATALOG = {  # site/app.js 의 CATALOG 와 같음
    "SEL": ["TYO", "OSA", "NGO", "FUK", "CTS", "OKA", "KOJ", "KMJ", "NGS", "OIT", "KMQ", "KIJ", "SDJ", "OKJ", "AOJ", "HIJ"],
    "PUS": ["TYO", "OSA", "FUK", "CTS"],
}
SHORT = {"SEL": "서울", "PUS": "부산", "TYO": "도쿄", "OSA": "오사카·고베"}


def months_between(a: tuple, b: tuple) -> int:
    return (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1


def build_route(kor: str, jpn: str, start: tuple, end: tuple, today: date | None = None) -> tuple[dict, list[str], list[str]]:
    """(노선, 막는 문제들, 경고들). 막는 문제가 있으면 저장하지 않아요."""
    today = today or date.today()
    errors, warns = [], []
    n = months_between(start, end)
    if n < 1:
        errors.append("끝 달이 시작 달보다 빨라요.")
    elif n > MAX_MONTHS:
        errors.append(f"검색 기간이 {n}개월이에요. 한 번에 최대 {MAX_MONTHS}개월(예: 2월~9월)까지 정할 수 있어요.")
    s = date(start[0], start[1], 1)
    e = date(end[0], end[1], calendar.monthrange(end[0], end[1])[1])
    if e < today:
        errors.append("기간이 이미 지났어요.")
    s = max(s, today)
    horizon = today + timedelta(days=BOOKABLE_DAYS)
    if e > horizon:
        warns.append(f"발권은 보통 약 1년 전부터 열려서 {horizon:%Y-%m-%d} 이후 날짜는 아직 안 나올 수 있어요.")
    name = f"{SHORT.get(kor, CITY.get(kor, kor))} → {SHORT.get(jpn, CITY.get(jpn, jpn).split(' ')[0])}"
    route = {
        "id": f"{kor}-{jpn}-{s:%Y%m%d}".lower(), "name": name, "from": kor, "to": jpn,
        "start": s.isoformat(), "end": e.isoformat(), "return_start": s.isoformat(), "return_end": e.isoformat(),
        "cabins": ["economy"], "target_miles": None, "nonstop": False, "adults": 1, "active": True,
    }
    return route, errors, warns


def save_route(route: dict, only_this: bool) -> str:
    """routes.json 에 넣거나(같은 출발·도착 노선이 있으면 바꿈) 저장. 무엇을 했는지 돌려줘요."""
    cfg = json.loads(ROUTES.read_text(encoding="utf-8"))
    routes = cfg.setdefault("routes", [])
    same = [r for r in routes if r["from"] == route["from"] and r["to"] == route["to"]]
    if same:
        old = same[0]
        route = {**old, **{k: route[k] for k in ("start", "end", "return_start", "return_end", "active")}}
        routes[routes.index(old)] = route
        what = f"기존 노선 {old['id']} 의 기간을 바꿨어요"
    else:
        routes.append(route)
        what = f"새 노선 {route['id']} 을 넣었어요"
    if only_this:
        for r in routes:
            r["active"] = r["id"] == route["id"]
        what += " · 다른 노선은 중지"
    ROUTES.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return what


def run(*args) -> subprocess.CompletedProcess:
    return subprocess.run(list(args), cwd=REPO, capture_output=True, text=True, encoding="utf-8",
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def publish(message: str) -> str:
    run("git", "pull", "--rebase", "--autostash")
    run("git", "add", str(ROUTES.relative_to(REPO)))
    c = run("git", "commit", "-m", f"마일 좌석 노선: {message}")
    p = run("git", "push")
    run(sys.executable, "award-tracker/tools/award.py", "sync")
    run(sys.executable, "award-tracker/tools/award.py", "publish")
    if p.returncode != 0:
        return "routes.json 은 저장했지만 GitHub 에 올리지 못했어요:\n" + (p.stderr or c.stderr)[-400:]
    return "GitHub 에 올렸어요. 휴대폰 앱에도 1~2분 뒤 보여요."


def current_routes_text() -> str:
    try:
        cfg = json.loads(ROUTES.read_text(encoding="utf-8"))
    except Exception:
        return "(routes.json 을 읽지 못했어요)"
    lines = []
    for r in cfg.get("routes", []):
        state = "조회" if r.get("active", True) else "중지"
        lines.append(f"[{state}] {r.get('name') or r['from'] + '→' + r['to']}  {r['start']} ~ {r['end']}")
    return "\n".join(lines) or "(노선 없음)"


def main():
    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title("마일 좌석 조회 노선")
    root.resizable(False, False)
    pad = {"padx": 8, "pady": 4}
    frm = ttk.Frame(root, padding=12)
    frm.grid()

    today = date.today()
    years = [str(today.year + i) for i in range(3)]
    months = [str(m) for m in range(1, 13)]

    ttk.Label(frm, text="한국 출발").grid(row=0, column=0, sticky="w", **pad)
    kor_var = tk.StringVar(value="SEL")
    kor = ttk.Combobox(frm, state="readonly", width=24, values=[f"{k}  {CITY[k]}" for k in CATALOG])
    kor.current(0)
    kor.grid(row=0, column=1, columnspan=4, sticky="w", **pad)

    ttk.Label(frm, text="일본 출발 (도착 도시)").grid(row=1, column=0, sticky="w", **pad)
    jpn = ttk.Combobox(frm, state="readonly", width=34)
    jpn.grid(row=1, column=1, columnspan=4, sticky="w", **pad)

    def fill_jpn(*_):
        k = kor.get().split()[0]
        kor_var.set(k)
        jpn["values"] = [f"{j}  {CITY[j]}" for j in CATALOG[k]]
        jpn.current(1 if len(CATALOG[k]) > 1 else 0)
    kor.bind("<<ComboboxSelected>>", fill_jpn)
    fill_jpn()

    def ym_row(r, label, y0, m0):
        ttk.Label(frm, text=label).grid(row=r, column=0, sticky="w", **pad)
        y = ttk.Combobox(frm, state="readonly", width=6, values=years); y.set(y0)
        m = ttk.Combobox(frm, state="readonly", width=4, values=months); m.set(m0)
        y.grid(row=r, column=1, sticky="w", **pad); ttk.Label(frm, text="년").grid(row=r, column=2, sticky="w")
        m.grid(row=r, column=3, sticky="w", **pad); ttk.Label(frm, text="월").grid(row=r, column=4, sticky="w")
        return y, m
    nxt = (today.replace(day=1) + timedelta(days=32))
    sy, sm = ym_row(2, "검색 시작", str(nxt.year), str(nxt.month))
    ey, em = ym_row(3, "검색 끝", str(nxt.year), str(nxt.month))
    ttk.Label(frm, text=f"왕복 · 이코노미 · 한 번에 최대 {MAX_MONTHS}개월", foreground="#666").grid(row=4, column=0, columnspan=5, sticky="w", **pad)

    only = tk.BooleanVar(value=True)
    ttk.Checkbutton(frm, text="이 노선만 조회 (다른 노선은 중지)", variable=only).grid(row=5, column=0, columnspan=5, sticky="w", **pad)

    routes_box = tk.Text(frm, width=56, height=5, font=("Malgun Gothic", 9), background="#f4f4f4", relief="flat")
    routes_box.grid(row=7, column=0, columnspan=5, **pad)

    def refresh():
        routes_box.configure(state="normal"); routes_box.delete("1.0", "end")
        routes_box.insert("1.0", "지금 노선\n" + current_routes_text()); routes_box.configure(state="disabled")

    def on_save():
        route, errors, warns = build_route(kor_var.get(), jpn.get().split()[0],
                                           (int(sy.get()), int(sm.get())), (int(ey.get()), int(em.get())))
        if errors:
            messagebox.showwarning("기간을 확인해 주세요", "\n".join(errors)); return
        msg = f"{route['name']}  {route['start']} ~ {route['end']} (왕복)"
        if warns:
            msg += "\n\n" + "\n".join(warns)
        if not messagebox.askokcancel("노선 저장", msg + "\n\n저장하고 GitHub 에 올릴까요?"):
            return
        what = save_route(route, only.get())
        refresh()
        messagebox.showinfo("저장", what + "\n" + publish(what))

    def on_search():
        if messagebox.askokcancel("조회 시작", "지금 마일 좌석 조회를 시작할까요?\n(크롬 '마일 조회' 프로필에 에어프랑스 로그인이 돼 있어야 해요)"):
            subprocess.Popen(["cmd", "/c", "start", "", str(PC / "award-search.cmd")], cwd=REPO)

    btns = ttk.Frame(frm); btns.grid(row=6, column=0, columnspan=5, sticky="w", **pad)
    ttk.Button(btns, text="노선 저장", command=on_save).grid(row=0, column=0, padx=(0, 8))
    ttk.Button(btns, text="지금 조회 시작", command=on_search).grid(row=0, column=1)
    refresh()
    root.mainloop()


if __name__ == "__main__":
    main()
