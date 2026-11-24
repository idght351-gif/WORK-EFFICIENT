// 실행: node --test award-tracker/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { isSecretKey, redactText, redactValue, redactUrl, shouldSkipUrl, cleanCapture, looksLikeAward } from "../extension/redact.js";

test("개인정보 항목 이름을 알아봄", () => {
  for (const k of ["firstName", "last_name", "EMAIL", "emailAddress", "flyingBlueNumber", "milesBalance", "awardMilesBalance", "accessToken", "dateOfBirth", "addressLine1", "phoneNumber"]) {
    assert.equal(isSecretKey(k), true, k);
  }
  for (const k of ["miles", "totalMiles", "tax", "amount", "currency", "origin", "destination", "cabin", "flightNumber", "name", "date"]) {
    assert.equal(isSecretKey(k), false, k);
  }
});

test("글자 속 이메일·토큰·긴 번호·인사말 이름을 가림", () => {
  const s = redactText("안녕하세요, 홍길동 님 / me@test.co.kr / 1234567890 / eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh / 12,500 마일 / KE703");
  assert.match(s, /안녕하세요, \[이름\] 님/);
  assert.ok(!s.includes("me@test.co.kr"));
  assert.ok(!s.includes("1234567890"));
  assert.ok(!s.includes("eyJhbGci"));
  assert.ok(s.includes("12,500 마일") && s.includes("KE703"));
});

test("JSON 안쪽까지 가리고 마일·세금은 남김", () => {
  const v = redactValue({ data: { customer: { firstName: "A", email: "a@b.cd", milesBalance: 999 }, offers: [{ miles: 12500, tax: { amount: 52300, currency: "KRW" }, note: "x@y.zz" }] } });
  assert.equal(v.data.customer.firstName, "[가림]");
  assert.equal(v.data.customer.email, "[가림]");
  assert.equal(v.data.customer.milesBalance, "[가림]");
  assert.deepEqual(v.data.offers[0].tax, { amount: 52300, currency: "KRW" });
  assert.equal(v.data.offers[0].miles, 12500);
  assert.equal(v.data.offers[0].note, "[이메일]");
});

test("주소 검사: 로그인·분석 주소는 건너뜀, 검색 주소는 남김", () => {
  assert.equal(shouldSkipUrl("https://wwws.airfrance.co.kr/gql/v1?operationName=X"), false);
  assert.equal(shouldSkipUrl("https://login.airfrance.com/oauth/authorize"), true);
  assert.equal(shouldSkipUrl("https://wwws.airfrance.co.kr/b/ss/collect"), true);
  assert.equal(shouldSkipUrl("not a url"), true);
  assert.ok(redactUrl("https://x.airfrance.com/a?email=a@b.cd&origin=ICN").includes("origin=ICN"));
  assert.ok(!redactUrl("https://x.airfrance.com/a?email=a@b.cd").includes("a%40b.cd"));
});

test("기록 정리: JSON 아닌 응답은 버리고, 요청 변수는 가림", () => {
  assert.equal(cleanCapture({ kind: "net", url: "https://wwws.airfrance.co.kr/x", body: "<html>" }), null);
  const c = cleanCapture({
    kind: "net", url: "https://wwws.airfrance.co.kr/gql/v1?operationName=Q", method: "post", status: 200,
    req: JSON.stringify({ variables: { origin: "ICN", lastName: "Hong" } }),
    body: JSON.stringify({ data: { lowestFare: { miles: 15000 } } }),
  });
  assert.equal(c.method, "POST");
  assert.equal(c.request.variables.origin, "ICN");
  assert.equal(c.request.variables.lastName, "[가림]");
  assert.equal(looksLikeAward(c), true);
  const p = cleanCapture({ kind: "page", url: "https://x/y", title: "t", text: "a@b.cd 15,000 마일", reason: "click" });
  assert.equal(p.text, "[이메일] 15,000 마일");
  assert.equal(cleanCapture({ kind: "weird" }), null);
});
