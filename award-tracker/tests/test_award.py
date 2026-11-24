"""실행: python -m unittest discover -s award-tracker/tests -v"""
import json
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import award  # noqa: E402

ROUTE = {
    "id": "icn-nrt-20270620", "name": "인천 → 도쿄 나리타", "from": "ICN", "to": "NRT",
    "start": "2027-06-20", "end": "2027-07-03", "return_start": "2027-06-25", "return_end": "2027-07-05",
    "cabins": ["economy", "business"], "target_miles": {"economy": 15000}, "nonstop": True, "adults": 1, "active": True,
}
PAUSED = {**ROUTE, "id": "gmp-hnd-x", "from": "GMP", "to": "HND", "return_start": None, "return_end": None, "active": False}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.P = award.Paths(self.root)
        self.set_now("2026-11-25T05:40:00+09:00")
        self.write_routes([ROUTE, PAUSED])

    def tearDown(self):
        os.environ.pop("AWARD_NOW", None)
        self.tmp.cleanup()

    def set_now(self, v):
        os.environ["AWARD_NOW"] = v

    def write_routes(self, routes, **settings):
        award.write_json(self.P.routes, {"settings": {"max_searches_per_run": 40, "max_details_per_route": 2, **settings}, "routes": routes})

    def index(self):
        return json.loads(self.P.index.read_text(encoding="utf-8"))

    def doc(self, rid="icn-nrt-20270620"):
        return json.loads(self.P.route_file(rid).read_text(encoding="utf-8"))

    def cal(self, days, direction="out", cabin="economy", **kw):
        return {"route_id": "icn-nrt-20270620", "direction": direction, "cabin": cabin, "source": "calendar", "days": days, **kw}


class SyncAndPlan(Base):
    def test_sync_removes_sample_and_builds_index(self):
        award.write_json(self.P.index, {"sample": True, "routes": [{"id": "sample-a"}, {"id": "icn-nrt-20270620"}]})
        award.write_json(self.P.route_file("sample-a"), {"route": {}})
        award.write_json(self.P.route_file("icn-nrt-20270620"), {"directions": {"out": {"days": {"2027-06-20": {"economy": {"miles": 1}}}}}})
        award.sync(self.P)
        idx = self.index()
        self.assertFalse(idx["sample"])
        self.assertFalse(self.P.route_file("sample-a").exists())
        self.assertEqual(self.doc()["directions"]["out"]["days"], {})  # 같은 id 의 샘플 날짜도 지움
        self.assertEqual([r["id"] for r in idx["routes"]], ["icn-nrt-20270620", "gmp-hnd-x"])
        self.assertEqual(set(self.doc()["directions"]), {"out", "back"})
        self.assertEqual(idx["runner"], {"status": "never"})

    def test_plan_skips_paused_and_orders_unchecked_first(self):
        s, routes = award.sync(self.P)
        planned, postponed = award.make_plan(self.P, s, routes)
        # 가는 편 6~7월 × 2등급 + 오는 편 6~7월 × 2등급
        self.assertEqual(len(planned), 8)
        self.assertFalse(postponed)
        self.assertTrue(all(x["route_id"] == "icn-nrt-20270620" for x in planned))
        self.assertEqual(planned[0]["period"], ["2027-06-20", "2027-06-30"])
        # 6월 이코노미 가는 편을 다 보고 나면 그 항목은 맨 뒤로
        days = {f"2027-06-{d}": 20000 for d in range(20, 31)}
        award.save_items(self.P, self.cal(days))
        planned, _ = award.make_plan(self.P, s, routes)
        self.assertEqual((planned[-1]["direction"], planned[-1]["cabin"], planned[-1]["month"]), ("out", "economy", "2027-06"))

    def test_plan_limit_postpones(self):
        self.write_routes([ROUTE], max_searches_per_run=3)
        s, routes = award.sync(self.P)
        planned, postponed = award.make_plan(self.P, s, routes)
        self.assertEqual((len(planned), len(postponed)), (3, 5))

    def test_plan_open_months(self):
        # 2026-11-25 + 355일 = 2027-11-15 → 6월 ~ 11월 (6개월) × 가는/오는 편, 이코노미만
        self.write_routes([{**ROUTE, "cabins": ["economy"]}], search_open_months=True)
        s, routes = award.sync(self.P)
        planned, _ = award.make_plan(self.P, s, routes)
        self.assertEqual(sorted({x["month"] for x in planned if x["direction"] == "out"}),
                         ["2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11"])
        self.assertEqual(len(planned), 12)
        self.assertEqual(max(x["period"][1] for x in planned), "2027-11-15")

    def test_search_cabins_and_business_from_detail(self):
        self.write_routes([ROUTE], search_cabins=["economy"])
        s, routes = award.sync(self.P)
        planned, _ = award.make_plan(self.P, s, routes)
        self.assertEqual({x["cabin"] for x in planned}, {"economy"})
        # 비즈니스는 캘린더 없이 상세에서 읽은 편만으로 저장
        award.save_items(self.P, self.cal({"2027-06-20": {"seats": "2+", "flights": [
            {"dep": "09:00", "miles": 23500}, {"dep": "13:00", "miles": 21500}]}}, cabin="business", source="detail"))
        e = self.doc()["directions"]["out"]["days"]["2027-06-20"]["business"]
        self.assertEqual((e["miles"], e["source"]), (21500, "detail"))

    def test_route_max_months(self):
        self.write_routes([{**ROUTE, "start": "2027-02-01", "end": "2027-10-01"}])
        with self.assertRaises(award.AwardError):
            award.sync(self.P)
        self.write_routes([{**ROUTE, "start": "2027-02-01", "end": "2027-09-30", "return_start": "2027-02-01", "return_end": "2027-09-30"}])
        award.sync(self.P)

    def test_skip_fresh_and_pending_details(self):
        self.write_routes([{**ROUTE, "cabins": ["economy"], "target_miles": None}], skip_fresh_hours=20, detail_within_pct=20, max_details_per_route=8)
        s, routes = award.sync(self.P)
        award.save_items(self.P, self.cal({f"2027-06-{d}": (8500 if d in (21, 22) else 9000 if d == 23 else 20000) for d in range(20, 31)}))
        skipped = []
        planned, _ = award.make_plan(self.P, s, routes, skipped)
        self.assertEqual([(x["direction"], x["month"]) for x in skipped], [("out", "2027-06")])
        self.assertNotIn(("out", "2027-06"), [(x["direction"], x["month"]) for x in planned])
        self.set_now("2026-11-26T05:41:00+09:00")   # 24시간 뒤엔 다시 검색
        self.assertIn(("out", "2027-06"), [(x["direction"], x["month"]) for x in award.make_plan(self.P, s, routes)[0]])
        det = award.pending_details(self.P, s, routes)
        self.assertEqual(det[0]["dates"], ["2027-06-21", "2027-06-22", "2027-06-23"])
        award.save_items(self.P, self.cal({"2027-06-21": {"flights": [{"dep": "09:00", "miles": 8500}], "tax": 18}}, source="detail"))
        self.assertEqual(award.pending_details(self.P, s, routes)[0]["dates"], ["2027-06-22", "2027-06-23"])

    def test_bad_config(self):
        self.write_routes([{**ROUTE, "cabins": ["first"]}])
        with self.assertRaises(award.AwardError):
            award.load_config(self.P)


class Merge(Base):
    def setUp(self):
        super().setUp()
        award.start(self.P)

    def test_calendar_save_first_run(self):
        out = award.save_items(self.P, self.cal({"2027-06-19": 10000, "2027-06-20": "15,000 마일", "2027-06-21": None, "2027-06-22": 20000}))
        days = self.doc()["directions"]["out"]["days"]
        self.assertNotIn("2027-06-19", days)  # 기간 밖
        self.assertEqual(days["2027-06-20"]["economy"]["miles"], 15000)
        self.assertIsNone(days["2027-06-21"]["economy"]["miles"])
        self.assertEqual(days["2027-06-20"]["economy"]["first_seen"], "2026-11-25T05:40:00+09:00")
        run = json.loads(self.P.alerts.read_text(encoding="utf-8"))
        self.assertEqual([(a["date"], a["kind"]) for a in run["alerts"]], [("2027-06-20", "first")])
        self.assertEqual(run["searches"], 1)
        self.assertIn("상세 확인 추천", "\n".join(out))
        s = self.index()["routes"][0]["summary"]["out"]["economy"]
        self.assertEqual((s["min"], s["hit"], s["avail"], s["checked"], s["fresh"]), (15000, 1, 2, 3, 1))

    def test_changes_between_runs(self):
        award.save_items(self.P, self.cal({"2027-06-20": 15000, "2027-06-21": 20000, "2027-06-22": None, "2027-06-23": 12500}))
        award.finish(self.P, "ok")
        self.set_now("2026-11-26T05:40:00+09:00")
        award.start(self.P)
        award.save_items(self.P, self.cal({"2027-06-20": 12500, "2027-06-21": 15000, "2027-06-22": 15000, "2027-06-23": 12500}))
        days = self.doc()["directions"]["out"]["days"]
        e20 = days["2027-06-20"]["economy"]
        self.assertEqual((e20["miles"], e20["prev_miles"], e20["first_seen"]), (12500, 15000, "2026-11-25T05:40:00+09:00"))
        self.assertEqual(days["2027-06-22"]["economy"]["first_seen"], "2026-11-26T05:40:00+09:00")
        run = json.loads(self.P.alerts.read_text(encoding="utf-8"))
        kinds = {a["date"]: a["kind"] for a in run["alerts"]}
        self.assertEqual(kinds, {"2027-06-20": "cheaper", "2027-06-21": "new", "2027-06-22": "new"})  # 6/23 은 그대로라 알림 없음

    def test_detail_then_calendar(self):
        award.save_items(self.P, self.cal({"2027-06-20": 15000}))
        award.save_items(self.P, self.cal({"2027-06-20": {"flights": [
            {"no": "KE 703", "dep": "09:00", "arr": "11:25", "miles": "15,000", "tax": {"amount": "52,300", "currency": "krw"}},
            {"no": "KE705", "dep": "13:40", "arr": "16:05", "miles": 17500, "tax": 52300},
        ], "seats": 2}}, source="detail"))
        e = self.doc()["directions"]["out"]["days"]["2027-06-20"]["economy"]
        self.assertEqual((e["miles"], e["tax"], e["seats"], e["flights"][0]["no"]), (15000, {"amount": 52300, "currency": "KRW"}, 2, "KE703"))
        run = json.loads(self.P.alerts.read_text(encoding="utf-8"))
        self.assertEqual(run["details"], {"icn-nrt-20270620": 1})
        self.assertEqual(run["alerts"][0]["tax"], {"amount": 52300, "currency": "KRW"})
        self.assertEqual(run["alerts"][0]["flights"], ["KE703", "KE705"])
        # 같은 마일로 캘린더를 다시 보면 세금은 그대로, 마일이 바뀌면 세금은 지움
        award.save_items(self.P, self.cal({"2027-06-20": 15000}))
        self.assertIn("tax", self.doc()["directions"]["out"]["days"]["2027-06-20"]["economy"])
        award.save_items(self.P, self.cal({"2027-06-20": 17500}))
        self.assertNotIn("tax", self.doc()["directions"]["out"]["days"]["2027-06-20"]["economy"])

    def test_detail_seats_plus(self):
        award.save_items(self.P, self.cal({"2027-06-20": {"flights": [{"dep": "09:00", "miles": 15000}], "seats": "2+"},
                                           "2027-06-21": {"flights": [{"dep": "09:00", "miles": 15000}], "seats": 1}}, source="detail"))
        days = self.doc()["directions"]["out"]["days"]
        self.assertEqual((days["2027-06-20"]["economy"]["seats"], days["2027-06-21"]["economy"]["seats"]), ("2+", 1))

    def test_detail_within_pct(self):
        self.write_routes([{**ROUTE, "target_miles": None}], max_details_per_route=15, detail_within_pct=20)
        award.sync(self.P)
        out = "\n".join(award.save_items(self.P, self.cal({"2027-06-20": 8500, "2027-06-21": 10000, "2027-06-22": 10500, "2027-06-23": None})))
        self.assertIn("상세 확인 추천", out)
        self.assertIn("6/20", out)
        self.assertIn("6/21", out)      # 10,000 ≤ 8,500 × 1.2 = 10,200
        self.assertNotIn("6/22", out)   # 10,500 은 넘음

    def test_detail_budget(self):
        award.save_items(self.P, self.cal({"2027-06-20": 15000, "2027-06-21": 12500, "2027-06-22": 15000}, cabin="economy"))
        award.save_items(self.P, self.cal({"2027-06-21": 12500, "2027-06-22": 15000}, source="detail"))
        out = award.save_items(self.P, self.cal({"2027-06-20": 15000}))
        self.assertIn("상세 확인 횟수를 다 썼어요", "\n".join(out))

    def test_errors(self):
        with self.assertRaises(award.AwardError):
            award.save_items(self.P, {**self.cal({}), "route_id": "nope"})
        with self.assertRaises(award.AwardError):
            award.save_items(self.P, self.cal({"2027-06-20": 1}, direction="sideways"))
        with self.assertRaises(award.AwardError):
            award.save_items(self.P, self.cal({"2027/06/20": 1}))
        with self.assertRaises(award.AwardError):
            award.save_items(self.P, self.cal({"2027-06-20": "많음"}))


class FinishAndMail(Base):
    def test_finish_and_mail(self):
        award.start(self.P)
        self.assertEqual(self.index()["runner"]["status"], "running")
        self.assertIsNone(award.build_alert_mail(json.loads(self.P.alerts.read_text(encoding="utf-8")), None))  # 아직 조회 중
        award.save_items(self.P, self.cal({"2027-06-20": 15000, "2027-06-21": 20000}))
        award.save_items(self.P, self.cal({"2027-06-27": 12500}, direction="back"))
        run = award.finish(self.P, "ok")
        r = self.index()["runner"]
        self.assertEqual((r["status"], r["searches"], r["max_searches"]), ("ok", 2, 40))
        subject, body = award.build_alert_mail(run, "https://example.github.io/flight-tracker/award/")
        self.assertEqual(subject, "[마일 좌석] 목표 이하 2건")
        self.assertIn("6/20(일) 15,000", body)
        self.assertIn("오는 편 NRT→ICN", body)
        self.assertIn("#r/icn-nrt-20270620", body)

    def test_no_mail_when_nothing_new(self):
        award.start(self.P)
        award.save_items(self.P, self.cal({"2027-06-21": 20000}))
        self.assertIsNone(award.build_alert_mail(award.finish(self.P, "ok"), None))

    def test_problem_mail(self):
        award.start(self.P)
        run = award.finish(self.P, "login_required", "로그인 화면이 나옴")
        subject, body = award.build_alert_mail(run, None)
        self.assertEqual(subject, "[마일 좌석] 로그인 필요")
        self.assertIn("다시 로그인", body)
        self.assertEqual(self.index()["runner"]["message"], "로그인 화면이 나옴")

    def test_send_dry_run(self):
        award.start(self.P)
        award.save_items(self.P, self.cal({"2027-06-20": 15000}))
        award.finish(self.P, "ok")
        out = award.send_alerts(self.P, dry_run=True)
        self.assertIn("미리 보기", out)
        self.assertIn("처음 조회", out)


class CityCodesNoTarget(Base):
    """SEL · TYO 같은 도시 코드, 목표 마일 없음, 직항 · 경유 모두."""
    def setUp(self):
        super().setUp()
        self.route = {"id": "sel-tyo-20270201", "name": "서울 → 도쿄", "from": "SEL", "to": "TYO",
                      "start": "2027-02-01", "end": "2027-02-28", "return_start": "2027-02-01", "return_end": "2027-02-28",
                      "cabins": ["economy", "business"], "target_miles": None, "nonstop": False, "adults": 1, "active": True}
        self.write_routes([self.route], max_details_per_route=3)
        award.start(self.P)

    def test_plan_shows_city_codes_and_stops(self):
        s, routes = award.load_config(self.P)
        planned, _ = award.make_plan(self.P, s, routes)
        self.assertEqual(len(planned), 4)  # 2월 × 2등급 × 가는/오는 편
        self.assertEqual((planned[0]["from"], planned[0]["to"], planned[0]["nonstop"]), ("SEL", "TYO", False))
        self.assertEqual({(x["from"], x["to"]) for x in planned}, {("SEL", "TYO"), ("TYO", "SEL")})

    def test_no_target_suggests_cheapest_days_and_no_alerts(self):
        out = award.save_items(self.P, {"route_id": "sel-tyo-20270201", "direction": "out", "cabin": "economy",
                                        "days": {"2027-02-03": 12500, "2027-02-04": 10000, "2027-02-05": 10000, "2027-02-06": None}})
        text = "\n".join(out)
        self.assertIn("상세 확인 추천 (남은 3개): 2/4(목), 2/5(금)", text)
        run = json.loads(self.P.alerts.read_text(encoding="utf-8"))
        self.assertEqual(run["alerts"], [])  # 목표가 없으면 알림 없음
        s = self.index()["routes"][0]["summary"]["out"]["economy"]
        self.assertEqual((s["min"], s["min_date"], s["hit"], s["avail"]), (10000, "2027-02-04", 0, 3))

    def test_connecting_flight_details(self):
        award.save_items(self.P, {"route_id": "sel-tyo-20270201", "direction": "out", "cabin": "economy", "source": "detail",
                                  "days": {"2027-02-04": {"tax": 61200, "flights": [
                                      {"no": "KE2101", "from": "gmp", "to": "hnd", "dep": "08:10", "arr": "10:20", "stops": 0, "miles": 10000},
                                      {"no": "MU5042", "from": "ICN", "to": "NRT", "dep": "09:00", "arr": "16:30", "stops": 1, "via": "PVG", "miles": 15000},
                                  ]}}})
        e = self.doc("sel-tyo-20270201")["directions"]["out"]["days"]["2027-02-04"]["economy"]
        self.assertEqual(e["miles"], 10000)
        self.assertEqual((e["flights"][0]["from"], e["flights"][0]["to"], e["flights"][0]["stops"]), ("GMP", "HND", 0))
        self.assertEqual((e["flights"][1]["stops"], e["flights"][1]["via"]), (1, "PVG"))
        self.assertEqual(e["tax"], {"amount": 61200, "currency": "KRW"})



class Refresh(Base):
    def test_refresh_starts_short_run_for_one_date(self):
        x = award.refresh_start(self.P, "icn-nrt-20270620", "back", ["2027-07-01"])
        self.assertEqual((x["from"], x["to"], x["dates"], x["months"]), ("NRT", "ICN", ["2027-07-01"], ["2027-07"]))
        self.assertEqual(self.index()["runner"]["status"], "running")
        self.assertEqual(json.loads(self.P.alerts.read_text(encoding="utf-8"))["mode"], "refresh")
        # 저장 · 끝은 평소 조회와 같음
        award.save_items(self.P, self.cal({"2027-07-01": 14000}, direction="back"))
        run = award.finish(self.P, "ok")
        self.assertEqual(run["searches"], 1)
        self.assertEqual(self.doc()["directions"]["back"]["days"]["2027-07-01"]["economy"]["miles"], 14000)

    def test_refresh_ignores_recent_check(self):
        # 방금 본 날짜도 사용자가 요청하면 다시 조회해요
        award.save_items(self.P, self.cal({"2027-06-21": 20000}))
        x = award.refresh_start(self.P, "icn-nrt-20270620", "out", ["2027-06-21", "2027-06-21"])
        self.assertEqual(x["dates"], ["2027-06-21"])

    def test_refresh_errors(self):
        bad = [
            ("nope", "out", ["2027-06-21"]),                       # 없는 노선
            ("gmp-hnd-x", "back", ["2027-06-21"]),                 # 오는 편 없는 노선
            ("icn-nrt-20270620", "out", ["2027-07-10"]),           # 기간 밖
            ("icn-nrt-20270620", "out", ["2027-6-21"]),            # 날짜 형식
            ("icn-nrt-20270620", "out", ["2027-06-20", "2027-06-21", "2027-06-22", "2027-06-23"]),  # 4일
        ]
        for args in bad:
            with self.assertRaises(award.AwardError, msg=args):
                award.refresh_start(self.P, *args)
        self.set_now("2027-06-25T09:00:00+09:00")
        with self.assertRaises(award.AwardError):
            award.refresh_start(self.P, "icn-nrt-20270620", "out", ["2027-06-21"])  # 지난 날짜

    def test_refresh_cli(self):
        import contextlib, io
        out = io.StringIO()
        with contextlib.redirect_stdout(out), unittest.mock.patch.object(award, "default_paths", return_value=self.P):
            code = award.main(["refresh", "icn-nrt-20270620", "out", "2027-06-21"])
        self.assertEqual(code, 0)
        self.assertIn("날짜 다시 조회 (사용자 요청): ICN→NRT 이코노미 직항만 6/21", out.getvalue())


class Marks(Base):
    def mark(self, iso="2027-06-21", at="2026-11-25T10:00:00+09:00", direction="out", **kw):
        return {"route_id": "icn-nrt-20270620", "direction": direction, "date": iso, "cabin": "economy",
                "status": "gone", "marked_at": at, **kw}

    def day(self, iso="2027-06-21", direction="out"):
        return self.doc()["directions"][direction]["days"].get(iso, {}).get("economy")

    def test_mark_gone_then_undo(self):
        award.save_items(self.P, self.cal({"2027-06-21": 14000, "2027-06-22": 16000}))
        award.write_json(self.P.marks, {"marks": [self.mark()]})
        award.apply_marks(self.P)
        e = self.day()
        self.assertEqual((e["miles"], e["source"], e["prev_miles"]), (None, "manual", 14000))
        self.assertEqual(self.index()["routes"][0]["summary"]["out"]["economy"]["min"], 16000)
        award.apply_marks(self.P)  # 두 번 해도 그대로
        self.assertEqual(self.day()["checked_at"], "2026-11-25T10:00:00+09:00")
        # 앱에서 표시를 지우면 원래 값으로
        award.write_json(self.P.marks, {"marks": []})
        award.apply_marks(self.P)
        self.assertEqual((self.day()["miles"], self.day()["source"]), (14000, "calendar"))

    def test_newer_lookup_wins_and_reopen_alerts(self):
        award.save_items(self.P, self.cal({"2027-06-21": 14000}))  # 05:40 조회
        award.write_json(self.P.marks, {"marks": [self.mark(at="2026-11-25T05:00:00+09:00")]})  # 그보다 먼저 찍은 표시
        award.apply_marks(self.P)
        self.assertEqual(self.day()["miles"], 14000)
        award.write_json(self.P.marks, {"marks": [self.mark()]})
        award.apply_marks(self.P)
        self.assertIsNone(self.day()["miles"])
        # 나중에 PC 가 다시 조회해서 좌석이 다시 있으면 새로 열림으로 알림
        self.set_now("2026-11-26T09:00:00+09:00")
        award.start(self.P)
        award.save_items(self.P, self.cal({"2027-06-21": 14000}))
        self.assertEqual((self.day()["miles"], self.day()["source"]), (14000, "calendar"))
        run = json.loads(self.P.alerts.read_text(encoding="utf-8"))
        self.assertEqual([a["date"] for a in run["alerts"]], ["2027-06-21"])
        award.apply_marks(self.P)  # 표시는 남아 있어도 더 새로운 조회가 이김
        self.assertEqual(self.day()["miles"], 14000)

    def test_bad_and_past_marks_are_dropped(self):
        award.write_json(self.P.marks, {"marks": [
            self.mark(), self.mark(route_id="nope"), self.mark(status="other"),
            self.mark(direction="back", iso="2027-06-21"), self.mark(iso="2026-11-01"),
            self.mark(direction="back", iso="2027-06-30"),
        ]})
        award.apply_marks(self.P)
        left = json.loads(self.P.marks.read_text(encoding="utf-8"))["marks"]
        self.assertEqual([(m["direction"], m["date"]) for m in left], [("out", "2027-06-21"), ("back", "2027-06-21"), ("back", "2027-06-30")])
        # 조회 전 날짜에 찍은 표시도 좌석 없음으로, 취소하면 다시 조회 전으로
        self.assertIsNone(self.day("2027-06-30", "back")["miles"])
        award.write_json(self.P.marks, {"marks": []})
        award.apply_marks(self.P)
        self.assertIsNone(self.day("2027-06-30", "back"))
        self.assertIsNone(self.day("2027-06-21", "back"))

    def test_no_marks_file(self):
        self.assertEqual(award.apply_marks(self.P), ["반영할 표시 변경이 없어요."])


if __name__ == "__main__":
    unittest.main()
