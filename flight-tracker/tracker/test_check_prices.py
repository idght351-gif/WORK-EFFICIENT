import unittest

from check_prices import build_report, compare_links, build_quota, searches_per_check, decide_alert, outbound_times_param, pick_cheapest, record_result, summarize

ROUTE = {"depart_after": "09:00", "depart_before": "12:00"}


def flight(price, dep, arr="2026-12-20 13:00", fn="KE 703"):
    return {"price": price, "total_duration": 140, "flights": [{
        "airline": "대한항공", "flight_number": fn,
        "departure_airport": {"time": f"2026-12-20 {dep}"},
        "arrival_airport": {"time": arr},
    }]}


class TestPick(unittest.TestCase):
    def test_picks_cheapest_within_window(self):
        data = {
            "best_flights": [flight(300000, "09:10")],
            "other_flights": [flight(200000, "08:30"), flight(250000, "11:50", fn="OZ 102"),
                              flight(150000, "12:30")],
        }
        best = pick_cheapest(data, ROUTE)
        self.assertEqual(best["price"], 250000)
        self.assertEqual(best["flight_number"], "OZ 102")
        self.assertEqual(best["stops"], 0)

    def test_none_when_nothing_matches(self):
        self.assertIsNone(pick_cheapest({"other_flights": [flight(1, "20:00")]}, ROUTE))
        self.assertIsNone(pick_cheapest({}, ROUTE))


class TestRoundTrip(unittest.TestCase):
    def test_return_window_and_params(self):
        from check_prices import build_params
        r = {"from": "ICN", "to": "CTS", "date": "2027-06-29", "return_date": "2027-07-05",
             "depart_after": "10:00", "depart_before": "24:00", "return_after": "12:00",
             "return_before": "24:00", "adults": 2}
        p = build_params(r, "k")
        self.assertEqual((p["type"], p["outbound_times"], p["return_times"], p["adults"]), (1, "10,23", "12,23", 2))
        data = {"other_flights": [flight(900000, "11:00"), flight(800000, "13:30", fn="7C 1101")]}
        self.assertEqual(pick_cheapest(data, r, "return")["flight_number"], "7C 1101")
        data = {"other_flights": [flight(700000, "09:00")]}
        self.assertIsNone(pick_cheapest(data, r, "return"))


    def test_check_route_two_step(self):
        import check_prices
        r = {"from": "ICN", "to": "CTS", "date": "2027-06-29", "return_date": "2027-07-05",
             "depart_after": "10:00", "return_after": "12:00", "adults": 2}
        out = flight(500000, "10:30", fn="KE 765"); out["departure_token"] = "tok"
        ret = flight(1200000, "14:00", fn="KE 766")
        calls = []
        def fake(params):
            calls.append(params)
            if "departure_token" in params:
                return {"other_flights": [ret, flight(900000, "08:00")]}
            return {"best_flights": [out], "price_insights": {"price_level": "typical"}}
        orig = check_prices.fetch_serpapi
        check_prices.fetch_serpapi = fake
        try:
            res, ins, _ = check_prices.check_route(r, "k")
        finally:
            check_prices.fetch_serpapi = orig
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["departure_token"], "tok")
        self.assertEqual(res["price"], 1200000)
        self.assertEqual((res["flight_number"], res["return_flight_number"]), ("KE 765", "KE 766"))
        self.assertNotIn("departure_token", res)
        self.assertEqual(ins["price_level"], "typical")


class TestTimes(unittest.TestCase):
    def test_hour_range(self):
        self.assertEqual(outbound_times_param("09:00", "12:00"), "9,11")
        self.assertEqual(outbound_times_param("09:30", "12:30"), "9,12")
        self.assertEqual(outbound_times_param("00:00", "24:00"), "0,23")


class TestAlert(unittest.TestCase):
    def test_sequence(self):
        state = {}
        sent, state = decide_alert(260000, 250000, state)
        self.assertFalse(sent)
        sent, state = decide_alert(240000, 250000, state)
        self.assertTrue(sent)
        sent, state = decide_alert(240000, 250000, state)   # 같은 가격 → 중복 발송 안 함
        self.assertFalse(sent)
        sent, state = decide_alert(230000, 250000, state)   # 더 내려감 → 발송
        self.assertTrue(sent)
        sent, state = decide_alert(270000, 250000, state)   # 다시 오름 → 초기화
        self.assertFalse(sent)
        sent, state = decide_alert(245000, 250000, state)   # 다시 내려감 → 발송
        self.assertTrue(sent)

    def test_no_price_or_threshold(self):
        self.assertFalse(decide_alert(None, 250000, {})[0])
        self.assertFalse(decide_alert(100, None, {})[0])


class TestRecord(unittest.TestCase):
    def test_failure_does_not_overwrite_success(self):
        h = record_result([], "2026-11-23", {"price": 100}, None, "t1", {})
        h = record_result(h, "2026-11-23", None, "timeout", "t2", {})
        self.assertEqual(len(h), 1)
        self.assertEqual(h[0]["price"], 100)

    def test_rerun_replaces_today(self):
        h = record_result([], "2026-11-23", {"price": 100}, None, "t1", {"price_level": "low"})
        h = record_result(h, "2026-11-23", {"price": 90}, None, "t2", {})
        self.assertEqual([x["price"] for x in h], [90])

    def test_summary(self):
        h = [{"date": "a", "price": 300}, {"date": "b", "price": None}, {"date": "c", "price": 100}]
        s = summarize(h)
        self.assertEqual((s["current"], s["prev"], s["min"], s["max"], s["avg"]), (100, 300, 100, 300, 200))


class TestQuota(unittest.TestCase):
    FETCHED = {"plan_name": "Free Plan", "searches_per_month": 250, "plan_searches_left": 240,
               "extra_credits": 0, "total_searches_left": 240, "this_month_usage": 10,
               "plan_renewal_date": "2026-12-20", "account_rate_limit_per_hour": 50}

    def test_searches_per_check(self):
        self.assertEqual(searches_per_check({"return_date": "2027-07-05"}), 2)
        self.assertEqual(searches_per_check({"return_date": None}), 1)
        self.assertEqual(searches_per_check({}), 1)

    def test_success_keeps_only_safe_fields(self):
        q = build_quota({**self.FETCHED}, None, 2, "2026-11-23T12:00:00+09:00")
        self.assertEqual(q["total_searches_left"], 240)
        self.assertEqual(q["daily_usage"], 2)
        self.assertEqual(q["checked_at"], "2026-11-23T12:00:00+09:00")
        self.assertNotIn("error", q)

    def test_failure_keeps_previous_values(self):
        prev = build_quota({**self.FETCHED}, None, 2, "2026-11-22T09:00:00+09:00")
        prev["api_key"] = "secret"
        q = build_quota(None, prev, 4, "2026-11-23T09:00:00+09:00", "timeout")
        self.assertEqual(q["total_searches_left"], 240)
        self.assertEqual(q["checked_at"], "2026-11-22T09:00:00+09:00")
        self.assertEqual(q["daily_usage"], 4)
        self.assertEqual(q["error"], "timeout")
        self.assertNotIn("api_key", q)


class TestCompareLinks(unittest.TestCase):
    def test_round_trip(self):
        r = {"from": "ICN", "to": "CTS", "date": "2027-06-29", "return_date": "2027-07-05",
             "adults": 2, "travel_class": "economy", "max_stops": None}
        links = compare_links(r)
        self.assertEqual(links["kayak"],
                         "https://www.kayak.co.kr/flights/ICN-CTS/2027-06-29/2027-07-05/2adults?sort=price_a")
        self.assertEqual(links["skyscanner"],
                         "https://www.skyscanner.co.kr/transport/flights/icn/cts/270629/270705/"
                         "?adultsv2=2&cabinclass=economy&rtn=1&preferdirects=false")

    def test_one_way_business_direct(self):
        r = {"from": "icn", "to": "nrt", "date": "2026-12-20", "adults": 1,
             "travel_class": "business", "max_stops": 0}
        links = compare_links(r)
        self.assertEqual(links["kayak"],
                         "https://www.kayak.co.kr/flights/ICN-NRT/2026-12-20/business?sort=price_a&fs=stops%3D0")
        self.assertIn("/icn/nrt/261220/?", links["skyscanner"])
        self.assertIn("cabinclass=business&rtn=0&preferdirects=true", links["skyscanner"])


class TestReport(unittest.TestCase):
    ROUTE = {"id": "r", "name": "인천 → 삿포로", "from": "ICN", "to": "CTS", "date": "2027-06-29",
             "return_date": "2027-07-05", "adults": 2, "travel_class": "economy", "alert_below": None}
    ENTRY = {"price": 1200000, "airline": "Trinity Airways", "flight_number": "TW 263",
             "depart_time": "10:10", "arrive_time": "13:00", "stops": 0,
             "return_airline": "Trinity Airways", "return_flight_number": "TW 264",
             "return_depart_time": "14:30", "return_arrive_time": "17:40"}
    SUMMARY = {"min": 1200000, "max": 1251754}

    def _report(self, entry, prev):
        from datetime import datetime
        items = [{"route": self.ROUTE, "entry": entry, "prev_price": prev,
                  "summary": self.SUMMARY, "flights_url": "https://example.com/g"}]
        return build_report(items, {"total_searches_left": 240, "plan_renewal_date": "2026-12-23"},
                            datetime(2026, 11, 24, 6, 31), "https://x.github.io/t")

    def test_price_drop(self):
        subject, body, html = self._report(self.ENTRY, 1251754)
        self.assertIn("1,200,000원", subject)
        self.assertIn("▼ 51,754원", subject)
        self.assertIn("오는 편: Trinity Airways TW 264", body)
        self.assertIn("kayak.co.kr", html)
        self.assertIn("SerpApi 남은 검색 240회", body)

    def test_failure(self):
        subject, body, _ = self._report({"price": None, "error": "timeout"}, 1251754)
        self.assertIn("조회 실패", subject)
        self.assertIn("timeout", body)


def mflight(price, date, dep, frm, to, fn, token=None, stops=0):
    legs = [{"airline": "Air", "flight_number": f"{fn}-{n}" if stops else fn,
             "departure_airport": {"time": f"{date} {dep}"},
             "arrival_airport": {"time": f"{date} 23:00"}} for n in range(stops + 1)]
    return {"price": price, "total_duration": 100, "flights": legs, "departure_token": token}


class TestStopsFilter(unittest.TestCase):
    def test_direct_only_skips_connections(self):
        data = {"other_flights": [flight(100000, "10:00"), flight(200000, "11:00", fn="OZ 1")]}
        data["other_flights"][0]["flights"].append(dict(data["other_flights"][0]["flights"][0]))
        best = pick_cheapest(data, {**ROUTE, "max_stops": 0})
        self.assertEqual(best["flight_number"], "OZ 1")
        self.assertEqual(pick_cheapest(data, ROUTE)["price"], 100000)


class TestMultiCity(unittest.TestCase):
    ROUTE = {"id": "m", "name": "다구간", "adults": 1, "travel_class": "economy", "max_stops": 0,
             "legs": [{"from": "ICN", "to": "CTS", "date": "2027-06-29", "depart_after": "10:00"},
                      {"from": "CTS", "to": "NRT", "date": "2027-07-02"},
                      {"from": "NRT", "to": "ICN", "date": "2027-07-05", "depart_after": "12:00"}]}

    def setUp(self):
        import check_prices
        self.cp = check_prices
        self.calls = []
        pages = {
            None: {"other_flights": [mflight(300000, "2027-06-29", "08:00", "ICN", "CTS", "A1", "t-early"),
                                     mflight(400000, "2027-06-29", "10:30", "ICN", "CTS", "A2", "t1")]},
            "t1": {"other_flights": [mflight(450000, "2027-07-02", "09:00", "CTS", "NRT", "B1", "t2"),
                                     mflight(420000, "2027-07-02", "15:00", "CTS", "NRT", "B2", "t2x", stops=1)]},
            "t2": {"other_flights": [mflight(500000, "2027-07-05", "13:00", "NRT", "ICN", "C1")]},
        }

        def fake_fetch(params, retries=3):
            self.calls.append(params)
            return pages[params.get("departure_token")]
        self._orig = check_prices.fetch_serpapi
        check_prices.fetch_serpapi = fake_fetch

    def tearDown(self):
        self.cp.fetch_serpapi = self._orig

    def test_follows_tokens_and_filters(self):
        route = self.cp.normalize_route(self.ROUTE)
        self.assertEqual((route["from"], route["to"], route["date"]), ("ICN", "ICN", "2027-06-29"))
        out, _, _ = self.cp.check_route(route, "k")
        self.assertEqual(out["price"], 500000)
        self.assertEqual([l["flight_number"] for l in out["legs"]], ["A2", "B1", "C1"])
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[0]["type"], 3)
        self.assertIn('"arrival_id":"NRT"', self.calls[0]["multi_city_json"])
        self.assertEqual(searches_per_check(route), 3)

    def test_links_and_report(self):
        from datetime import datetime
        route = self.cp.normalize_route(self.ROUTE)
        links = compare_links(route)
        self.assertEqual(links["kayak"], "https://www.kayak.co.kr/flights/ICN-CTS/2027-06-29/"
                                         "CTS-NRT/2027-07-02/NRT-ICN/2027-07-05?sort=price_a&fs=stops%3D0")
        self.assertTrue(links["skyscanner"].startswith(
            "https://www.skyscanner.co.kr/transport/d/icn/2027-06-29/cts/cts/2027-07-02/nrt/nrt/2027-07-05/icn/?"))
        out, _, _ = self.cp.check_route(route, "k")
        _, body, html = build_report([{"route": route, "entry": out, "prev_price": None,
                                       "summary": {"min": 500000, "max": 500000}, "flights_url": None}],
                                     None, datetime(2026, 11, 24, 6, 30), None)
        self.assertIn("2구간 07/02 CTS→NRT: Air B1 09:00 → 23:00 직항", body)
        self.assertIn("(다구간)", body)


class TestConnection(unittest.TestCase):
    def test_same_day_needs_connection_time(self):
        from check_prices import NO_CONNECTION, connection_after
        prev = {"date": "2027-07-03", "arrive_time": "12:40"}
        self.assertEqual(connection_after(prev, {"date": "2027-07-03"}, None, 120), "14:40")
        self.assertEqual(connection_after(prev, {"date": "2027-07-03"}, "16:00", 120), "16:00")
        self.assertEqual(connection_after(prev, {"date": "2027-07-03"}, "10:00", 120), "14:40")
        self.assertEqual(connection_after(prev, {"date": "2027-07-04"}, "08:00", 120), "08:00")
        self.assertIs(connection_after({"date": "2027-07-03", "arrive_time": "23:00"},
                                       {"date": "2027-07-03"}, None, 120), NO_CONNECTION)
        self.assertIsNone(connection_after({"date": "2027-07-02", "arrive_time": "23:00"},
                                           {"date": "2027-07-03"}, None, 120))

    def test_same_day_leg_picks_connecting_flight(self):
        import check_prices as cp
        route = cp.normalize_route({"id": "x", "name": "x", "adults": 1, "max_stops": 0, "legs": [
            {"from": "AKJ", "to": "HND", "date": "2027-07-03"}, {"from": "HND", "to": "GMP", "date": "2027-07-03"}]})
        pages = {
            None: {"other_flights": [mflight(100000, "2027-07-03", "10:00", "AKJ", "HND", "JL552", "t1")]},
            "t1": {"other_flights": [mflight(150000, "2027-07-03", "08:00", "HND", "GMP", "EARLY"),
                                     mflight(180000, "2027-07-03", "12:00", "HND", "GMP", "TOOSOON"),
                                     mflight(200000, "2027-07-03", "14:30", "HND", "GMP", "OK")]},
        }
        pages[None]["other_flights"][0]["flights"][0]["arrival_airport"]["time"] = "2027-07-03 11:40"
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = lambda params, retries=3: pages[params.get("departure_token")]
        try:
            out, _, _ = cp.check_route(route, "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertEqual(out["legs"][1]["flight_number"], "OK")
        self.assertEqual(out["price"], 200000)

    def test_reports_which_leg_failed(self):
        import check_prices as cp
        route = cp.normalize_route({"id": "x", "name": "x", "adults": 1, "max_stops": 0, "legs": [
            {"from": "ICN", "to": "UKB", "date": "2027-02-26"}, {"from": "KIX", "to": "GMP", "date": "2027-03-01"}]})
        pages = {None: {"other_flights": [mflight(100000, "2027-02-26", "09:00", "ICN", "UKB", "A", "t1")]},
                 "t1": {"other_flights": [mflight(200000, "2027-03-01", "10:00", "KIX", "GMP", "B", stops=1)]}}
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = lambda params, retries=3: pages[params.get("departure_token")]
        try:
            with self.assertRaises(RuntimeError) as ctx:
                cp.check_route(route, "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertIn("2구간 KIX→GMP", str(ctx.exception))
        self.assertIn("검색 결과 1개 · 경유 조건 통과 0개", str(ctx.exception))


class TestCheckPlan(unittest.TestCase):
    def test_next_and_last(self):
        from datetime import datetime
        from check_prices import KST, check_plan, kst_label
        r = {"date": "2027-06-26"}
        p = check_plan(r, "active", datetime(2026, 11, 24, 5, 0, tzinfo=KST), ["06:30"])
        self.assertEqual(p["next_check"], "2026-11-24T06:30+09:00")
        self.assertEqual(p["last_check"], "2027-06-26T06:30+09:00")
        p = check_plan(r, "active", datetime(2026, 11, 24, 7, 0, tzinfo=KST), ["06:30", "18:30"])
        self.assertEqual(p["next_check"], "2026-11-24T18:30+09:00")
        p = check_plan(r, "active", datetime(2026, 11, 24, 19, 0, tzinfo=KST), ["06:30", "18:30"])
        self.assertEqual(p["next_check"], "2026-11-25T06:30+09:00")
        self.assertEqual(kst_label(p["next_check"]), "11/25(수) 06:30")

    def test_skip_retry_runs(self):
        from check_prices import should_skip_scheduled
        self.assertTrue(should_skip_scheduled("2026-11-24", "2026-11-24"))
        self.assertFalse(should_skip_scheduled("2026-11-23", "2026-11-24"))
        self.assertFalse(should_skip_scheduled(None, "2026-11-24"))

    def test_departure_day_is_last(self):
        from datetime import datetime
        from check_prices import KST, check_plan
        r = {"date": "2027-06-26"}
        self.assertIsNone(check_plan(r, "active", datetime(2027, 6, 26, 7, 0, tzinfo=KST), ["06:30"])["next_check"])
        self.assertEqual(check_plan(r, "active", datetime(2027, 6, 25, 7, 0, tzinfo=KST), ["06:30"])["next_check"],
                         "2027-06-26T06:30+09:00")
        self.assertIsNone(check_plan(r, "paused", datetime(2027, 1, 1, tzinfo=KST), ["06:30"])["next_check"])


class TestSeparateTickets(unittest.TestCase):
    def test_sums_one_way_legs(self):
        import check_prices as cp
        route = cp.normalize_route({"id": "x", "name": "x", "adults": 1, "max_stops": 0, "separate_tickets": True,
                                    "legs": [{"from": "ICN", "to": "UKB", "date": "2027-02-26"},
                                             {"from": "KIX", "to": "GMP", "date": "2027-03-01", "depart_after": "12:00"}]})
        pages = {
            ("ICN", "UKB"): {"other_flights": [mflight(150000, "2027-02-26", "08:00", "ICN", "UKB", "LJ 271"),
                                               mflight(120000, "2027-02-26", "13:00", "ICN", "UKB", "TW 291")]},
            ("KIX", "GMP"): {"other_flights": [mflight(90000, "2027-03-01", "09:00", "KIX", "GMP", "EARLY"),
                                               mflight(110000, "2027-03-01", "15:00", "KIX", "GMP", "7C 1381")]},
        }
        calls = []

        def fake(params, retries=3):
            calls.append(params)
            return pages[(params["departure_id"], params["arrival_id"])]
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = fake
        try:
            out, _, _ = cp.check_route(route, "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertEqual(out["price"], 230000)
        self.assertEqual([l["flight_number"] for l in out["legs"]], ["TW 291", "7C 1381"])
        self.assertEqual([c["type"] for c in calls], [2, 2])
        self.assertTrue(all("departure_token" not in c for c in calls))
        self.assertIn("· 110,000원", dict(cp.flight_lines(out))["2구간 03/01 KIX→GMP"])


class TestChangedRoutes(unittest.TestCase):
    def test_detects_new_and_edited(self):
        import check_prices as cp
        prev = {"routes": [{"id": "a", "max_stops": 0}, {"id": "b", "max_stops": None}]}

        class R:
            stdout = __import__("json").dumps(prev)
        orig = cp.subprocess.run
        cp.subprocess.run = lambda *a, **k: R()
        try:
            got = cp.changed_route_ids([{"id": "a", "max_stops": 0}, {"id": "b", "max_stops": 0}, {"id": "c"}])
        finally:
            cp.subprocess.run = orig
        self.assertEqual(got, {"b", "c"})

    def test_unknown_history_checks_everything(self):
        import check_prices as cp
        orig = cp.subprocess.run

        def boom(*a, **k):
            raise cp.subprocess.CalledProcessError(128, "git")
        cp.subprocess.run = boom
        try:
            self.assertIsNone(cp.changed_route_ids([{"id": "a"}]))
        finally:
            cp.subprocess.run = orig


class TestMultiAirport(unittest.TestCase):
    def test_params_and_links(self):
        import check_prices as cp
        r = {"from": "ICN,GMP", "to": "KIX, UKB", "date": "2027-02-27", "return_date": None,
             "adults": 1, "travel_class": "economy", "max_stops": 0}
        p = cp.build_params(r, "k")
        self.assertEqual((p["departure_id"], p["arrival_id"], p["type"]), ("ICN,GMP", "KIX,UKB", 2))
        links = compare_links(r)
        self.assertEqual(links["kayak"], "https://www.kayak.co.kr/flights/SEL-OSA/2027-02-27?sort=price_a&fs=stops%3D0")
        self.assertIn("/transport/flights/sela/osaa/270227/", links["skyscanner"])
        self.assertEqual(cp.site_codes("ICN"), ("ICN", "icn"))
        self.assertEqual(cp.site_codes("ICN,CJU"), ("ICN", "icn"))


class TestFlex(unittest.TestCase):
    ROUTE = {"id": "kr-jp", "name": "한국 → 일본", "from": "KR", "to": "JP", "adults": 1,
             "travel_class": "economy", "max_stops": 0, "flex": {"months": ["2027-02"], "weekdays": [4, 5]}}

    def test_dates_and_label(self):
        import check_prices as cp
        ds = cp.flex_dates(self.ROUTE["flex"])
        self.assertEqual([d.isoformat() for d in ds][:3], ["2027-02-05", "2027-02-06", "2027-02-12"])
        self.assertEqual(len(ds), 8)
        self.assertEqual(cp.flex_label(self.ROUTE["flex"]), "2027년 2월 금·토요일 · 편도")
        self.assertEqual(cp.resolve_place("KR"), "ICN,GMP,CJJ")
        self.assertEqual(cp.resolve_place("icn, /m/03_3d,JP"), "ICN,/m/03_3d,/m/03_3d")
        r = cp.normalize_route(self.ROUTE)
        self.assertEqual((r["date"], r["return_date"]), ("2027-02-05", None))
        self.assertEqual(cp.searches_per_check(r), 2)

    def test_picks_cheapest_weekday_then_details(self):
        import check_prices as cp
        calls = []
        cal = {"prices": [{"outbound_date": "2027-02-03", "price": 50000},   # 수요일 → 제외
                          {"outbound_date": "2027-02-12", "price": 99000},
                          {"outbound_date": "2027-02-20", "price": 88000},
                          {"outbound_date": "2027-02-27", "price": 120000}]}
        detail = {"other_flights": [mflight(91000, "2027-02-20", "09:30", "GMP", "HND", "7C 1101")]}

        def fake(params, retries=3):
            calls.append(params)
            return cal if params["engine"] == "google_flights_calendar" else detail
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = fake
        try:
            out, _, _ = cp.check_route(cp.normalize_route(self.ROUTE), "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertEqual(calls[0]["departure_id"], "ICN,GMP,CJJ")
        self.assertEqual((calls[0]["date_range_start"], calls[0]["date_range_end"], calls[0]["type"]),
                         ("2027-02-05", "2027-02-27", 2))
        self.assertEqual((calls[1]["outbound_date"], calls[1]["arrival_id"]), ("2027-02-20", "/m/03_3d"))
        self.assertEqual((out["flex_date"], out["price"], out["calendar_price"]), ("2027-02-20", 91000, 88000))
        self.assertEqual([t["date"] for t in out["flex_top"]], ["2027-02-20", "2027-02-12", "2027-02-27"])
        rows = dict(cp.flight_lines(out))
        self.assertTrue(rows["가장 싼 날"].startswith("2/20(토)"))


class TestFlexFallback(unittest.TestCase):
    def test_tries_next_date_when_time_window_fails(self):
        import check_prices as cp
        route = cp.normalize_route({"id": "x", "name": "x", "from": "KR", "to": "JP", "adults": 1, "max_stops": None,
                                    "depart_after": "19:30", "flex": {"months": ["2027-02"], "weekdays": [4]}})
        cal = {"prices": [{"outbound_date": "2027-02-05", "price": 50000},
                          {"outbound_date": "2027-02-12", "price": 60000}]}
        pages = {"2027-02-05": {"other_flights": [mflight(50000, "2027-02-05", "19:05", "ICN", "NRT", "EARLY")]},
                 "2027-02-12": {"other_flights": [mflight(61000, "2027-02-12", "20:10", "ICN", "NRT", "LATE")]}}
        calls = []

        def fake(params, retries=3):
            calls.append(params)
            return cal if params["engine"] == "google_flights_calendar" else pages[params["outbound_date"]]
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = fake
        try:
            out, _, _ = cp.check_route(route, "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertEqual(calls[0]["outbound_times"], "19,23")
        self.assertEqual((out["flex_date"], out["flight_number"], out["price"]), ("2027-02-12", "LATE", 61000))
        self.assertEqual([x["date"] for x in out["flex_top"]], ["2027-02-12"])


class TestFlexDates(unittest.TestCase):
    def test_picked_dates(self):
        import check_prices as cp
        flex = {"dates": ["2026-12-12", "2026-12-11", "2026-12-12"], "trip_days": 2}
        self.assertEqual([d.isoformat() for d in cp.flex_dates(flex)], ["2026-12-11", "2026-12-12"])
        self.assertEqual(cp.flex_label(flex), "12/11(금) · 12/12(토) 중 가장 싼 날 · 2박 왕복")


class TestFlexDirectFallback(unittest.TestCase):
    def test_empty_calendar_searches_each_date(self):
        import check_prices as cp
        route = cp.normalize_route({"id": "x", "name": "x", "from": "KR", "to": "JP", "adults": 1, "max_stops": None,
                                    "depart_after": "19:00", "flex": {"dates": ["2027-02-12", "2027-02-19"], "trip_days": 1}})
        outs = {"2027-02-12": [mflight(300000, "2027-02-12", "20:00", "ICN", "NRT", "A", "t12")],
                "2027-02-19": [mflight(250000, "2027-02-19", "21:00", "ICN", "KIX", "B", "t19")]}
        rets = {"t12": [mflight(310000, "2027-02-13", "10:00", "NRT", "ICN", "A2")],
                "t19": [mflight(260000, "2027-02-20", "11:00", "KIX", "ICN", "B2")]}
        calls = []

        def fake(params, retries=3):
            calls.append(params)
            if params["engine"] == "google_flights_calendar":
                return {"prices": []}
            if params.get("departure_token"):
                return {"other_flights": rets[params["departure_token"]]}
            return {"other_flights": outs[params["outbound_date"]]}
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = fake
        try:
            out, _, _ = cp.check_route(route, "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertEqual((out["flex_date"], out["flex_return_date"], out["price"]), ("2027-02-19", "2027-02-20", 260000))
        self.assertEqual([t["date"] for t in out["flex_top"]], ["2027-02-19", "2027-02-12"])
        self.assertEqual(len(calls), 5)  # 달력 1 + 날짜별 왕복 2×2

    def test_changed_route_failure_replaces_old_success(self):
        h = [{"date": "2026-11-27", "price": 100, "error": None}]
        kept = record_result(h, "2026-11-27", None, "boom", "t", {})
        self.assertEqual(kept[-1]["price"], 100)
        replaced = record_result(h, "2026-11-27", None, "boom", "t", {}, replace=True)
        self.assertEqual((replaced[-1]["price"], replaced[-1]["error"]), (None, "boom"))


class TestOptions(unittest.TestCase):
    def test_keeps_sorted_unique_options(self):
        import check_prices as cp
        data = {"best_flights": [flight(300000, "10:00", fn="A")],
                "other_flights": [flight(200000, "11:00", fn="B"), flight(200000, "11:00", fn="B"),
                                  flight(150000, "08:00", fn="EARLY"), flight(250000, "11:30", fn="C")]}
        route = {"from": "ICN", "to": "NRT", "date": "2026-12-20", "return_date": None,
                 "depart_after": "09:00", "depart_before": "12:00", "adults": 1, "travel_class": "economy", "max_stops": None}
        orig = cp.fetch_serpapi
        cp.fetch_serpapi = lambda params, retries=3: data
        try:
            out, _, _ = cp.check_route(route, "k")
        finally:
            cp.fetch_serpapi = orig
        self.assertEqual(out["flight_number"], "B")
        self.assertEqual([o["flight_number"] for o in out["options"]], ["B", "C", "A"])
        self.assertEqual(out["options"][0]["date"], "2026-12-20")


class TestOptionsOnlyLatest(unittest.TestCase):
    def test_older_entries_drop_options(self):
        h = [{"date": "2026-11-26", "price": 100, "error": None, "options": [{"price": 100}]}]
        out = record_result(h, "2026-11-27", {"price": 90, "options": [{"price": 90}]}, None, "t", {})
        self.assertNotIn("options", out[0])
        self.assertEqual(out[-1]["options"], [{"price": 90}])


if __name__ == "__main__":
    unittest.main()
