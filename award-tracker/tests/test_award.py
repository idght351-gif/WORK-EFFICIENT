"""실행: python -m unittest discover -s award-tracker/tests -v"""
import json
import os
import sys
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
