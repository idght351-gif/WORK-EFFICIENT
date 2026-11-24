// 기록 파일에 개인정보가 들어가지 않도록 가리는 규칙 (확장 프로그램과 테스트가 함께 씀)

// 이런 주소의 응답은 아예 저장하지 않음 (로그인·보안 확인·광고/분석)
const SKIP_HOST_PATH =
  /(login|logout|signin|sign-in|logon|connexion|oauth|openid|password|consent|captcha|challenge|akam|sensor|beacon|analytics|collect|tracking|telemetry|doubleclick|optimizely|qualtrics|medallia|datadome|newrelic|dynatrace|adobedtm|omtrdc|demdex)/i;

// 이런 이름의 항목은 값을 가림 (이름에서 기호를 빼고 소문자로 비교)
const SECRET_KEYS = new Set([
  "firstname", "lastname", "givenname", "familyname", "middlename", "surname", "fullname", "maidenname",
  "email", "emailaddress", "mail", "phone", "phonenumber", "mobile", "mobilenumber", "telephone",
  "birthdate", "dateofbirth", "dob", "gender", "address", "street", "postalcode", "zipcode", "zip",
  "passport", "passportnumber", "documentnumber", "nationalid",
  "membershipnumber", "membershipid", "loyaltynumber", "loyaltyid", "frequentflyernumber",
  "flyingbluenumber", "flyingblueid", "fbnumber", "customerid", "customernumber", "accountid",
  "accountnumber", "personid", "userid", "username", "login",
  "token", "accesstoken", "idtoken", "refreshtoken", "authorization", "cookie", "password",
  "cardnumber", "iban", "cvv", "cvc",
]);

export function isSecretKey(key) {
  const k = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!k) return false;
  return SECRET_KEYS.has(k) || /^addressline\d*$/.test(k) || k.includes("balance");
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const LONG_DIGITS = /(?<![\d.])\d{9,}(?![\d.])/g;
const KO_GREETING = /(안녕하세요[,!]?\s*)([^\s\n,!.]{1,20})(\s*님)/g;

export function redactText(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(JWT, "[토큰]")
    .replace(EMAIL, "[이메일]")
    .replace(LONG_DIGITS, "[번호]")
    .replace(KO_GREETING, "$1[이름]$3");
}

export function redactValue(v, depth = 0) {
  if (depth > 60) return "[너무 깊음]";
  if (typeof v === "string") return redactText(v);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = isSecretKey(k) && x != null && typeof x !== "boolean" ? "[가림]" : redactValue(x, depth + 1);
    }
    return out;
  }
  return v;
}

export function shouldSkipUrl(url) {
  try {
    const u = new URL(url);
    return SKIP_HOST_PATH.test(u.hostname + u.pathname);
  } catch {
    return true;
  }
}

export function redactUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (isSecretKey(k)) u.searchParams.set(k, "[가림]");
      else u.searchParams.set(k, redactText(u.searchParams.get(k)));
    }
    return u.toString();
  } catch {
    return redactText(String(url));
  }
}

function parseJSON(text) {
  if (typeof text !== "string") return undefined;
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

// 확장 프로그램이 받은 기록 한 건을 저장할 모양으로 바꿈. 저장하지 않을 거면 null.
export function cleanCapture(c) {
  const base = { kind: c.kind, t: c.t || Date.now(), page: c.page ? redactUrl(c.page) : undefined };
  if (c.kind === "net") {
    if (!c.url || shouldSkipUrl(c.url)) return null;
    const body = parseJSON(c.body);
    if (body === undefined) return null; // JSON 이 아닌 응답은 버림
    const reqJSON = parseJSON(c.req);
    return {
      ...base,
      url: redactUrl(c.url),
      method: String(c.method || "GET").toUpperCase(),
      status: c.status,
      request: reqJSON !== undefined ? redactValue(reqJSON) : c.req ? redactText(String(c.req)).slice(0, 20000) : null,
      body: redactValue(body),
    };
  }
  if (c.kind === "page") {
    return { ...base, reason: c.reason, title: redactText(c.title || ""), url: redactUrl(c.url || c.page || ""), text: redactText(String(c.text || "")).slice(0, 40000) };
  }
  if (c.kind === "click" || c.kind === "input") {
    const el = c.el && typeof c.el === "object" ? redactValue(c.el) : null;
    const out = { ...base, el };
    if (c.kind === "input") out.value = redactText(String(c.value ?? "")).slice(0, 80);
    if (c.kind === "click") { out.x = c.x; out.y = c.y; }
    return out;
  }
  if (c.kind === "note") return { ...base, text: redactText(String(c.text || "")).slice(0, 2000) };
  return null;
}

// 마일·세금처럼 보이는 데이터가 들어 있는지 대충 확인 (관리 화면 표시용)
export function looksLikeAward(capture) {
  if (!capture || capture.kind !== "net") return false;
  const s = JSON.stringify(capture.body || "").slice(0, 400000);
  return /mile|award|reward|tax|surcharge|lowestFare|cabin|flightProduct|itinerar/i.test(s);
}
