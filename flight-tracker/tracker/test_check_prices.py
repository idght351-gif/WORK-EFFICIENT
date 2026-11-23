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


if __name__ == "__main__":
    unittest.main()
