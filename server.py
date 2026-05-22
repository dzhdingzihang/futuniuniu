from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import base64
from datetime import datetime
import json
import os
import re
import sys


ROOT = Path(__file__).resolve().parent
SINA_URL = "https://hq.sinajs.cn/list={symbols}"
EASTMONEY_KLINE_URL = (
    "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    "?secid={secid}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55"
    "&klt=101&fqt=1&end=20500101&lmt={limit}"
)
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range}&interval={interval}"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://finance.sina.com.cn/",
}
FALLBACK_RATES = {"USD_CNY": 7.22, "HKD_CNY": 0.92}


def fetch_text(url, timeout=10):
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("gb18030", errors="ignore")


def fetch_json(url, timeout=10):
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="ignore"))


def to_float(parts, index):
    try:
        return float(parts[index])
    except (IndexError, TypeError, ValueError):
        return None


def parse_quote(symbol, raw):
    parts = raw.split(",")
    if symbol.startswith(("sh", "sz")):
        price = to_float(parts, 3)
        prev_close = to_float(parts, 2)
        change = price - prev_close if price and prev_close else None
        change_pct = change / prev_close * 100 if change is not None and prev_close else None
    elif symbol.startswith("hk"):
        price = to_float(parts, 6)
        change = to_float(parts, 7)
        change_pct = to_float(parts, 8)
    else:
        price = to_float(parts, 1)
        change_pct = to_float(parts, 2)
        change = to_float(parts, 4)

    if not price or price <= 0:
        return None

    return {
        "price": price,
        "change": change,
        "changePct": change_pct,
    }


def handle_quotes(symbols):
    safe_symbols = [
        symbol
        for symbol in symbols.split(",")
        if re.fullmatch(r"(sh|sz|hk|gb_)[A-Za-z0-9_]+", symbol)
    ]
    if not safe_symbols:
        return {"quotes": {}}

    text = fetch_text(SINA_URL.format(symbols=",".join(safe_symbols)))
    quotes = {}

    for symbol in safe_symbols:
        match = re.search(rf'var hq_str_{re.escape(symbol)}="(.*?)";', text)
        if not match:
            continue
        quote = parse_quote(symbol, match.group(1))
        if quote:
            quotes[symbol] = quote

    return {"quotes": quotes}


def eastmoney_secids(symbol):
    if symbol.startswith("sh"):
        return [f"1.{symbol[2:]}"]
    if symbol.startswith("sz"):
        return [f"0.{symbol[2:]}"]
    if symbol.startswith("hk"):
        return [f"116.{symbol[2:]}"]
    if symbol.startswith("gb_"):
        code = symbol[3:].upper()
        return [f"105.{code}", f"106.{code}", f"107.{code}"]
    return []


def yahoo_symbol(symbol):
    if symbol.startswith("sh"):
        return f"{symbol[2:]}.SS"
    if symbol.startswith("sz"):
        return f"{symbol[2:]}.SZ"
    if symbol.startswith("hk"):
        return f"{symbol[2:].lstrip('0').zfill(4)}.HK"
    if symbol.startswith("gb_"):
        return symbol[3:].upper()
    return None


def parse_yahoo_payload(payload):
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        return []

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    series = []

    for index, ts in enumerate(timestamps):
        close = closes[index] if index < len(closes) else None
        if not close or close <= 0:
            continue
        date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
        series.append({
            "date": date,
            "time": datetime.fromtimestamp(ts).strftime("%H:%M"),
            "open": opens[index] if index < len(opens) and opens[index] else close,
            "high": highs[index] if index < len(highs) and highs[index] else close,
            "low": lows[index] if index < len(lows) and lows[index] else close,
            "close": close,
        })

    return series


def fetch_yahoo_history(symbol, days, range_value="2mo", interval="1d"):
    mapped = yahoo_symbol(symbol)
    if not mapped:
        return []
    payload = fetch_json(YAHOO_CHART_URL.format(symbol=mapped, range=range_value, interval=interval), timeout=8)
    return parse_yahoo_payload(payload)[-days:]


def parse_kline_payload(payload):
    klines = payload.get("data", {}).get("klines") or []
    series = []
    for line in klines:
        parts = line.split(",")
        if len(parts) < 3:
            continue
        close = to_float(parts, 2)
        if close and close > 0:
            series.append({"date": parts[0], "time": "", "open": to_float(parts, 1) or close, "high": to_float(parts, 3) or close, "low": to_float(parts, 4) or close, "close": close})
    return series


def fetch_history_for_symbol(symbol, days):
    try:
        series = fetch_yahoo_history(symbol, days)
        if series:
            return series
    except Exception:
        pass

    limit = max(days + 10, 45)
    for secid in eastmoney_secids(symbol):
        try:
            payload = fetch_json(EASTMONEY_KLINE_URL.format(secid=secid, limit=limit), timeout=8)
            series = parse_kline_payload(payload)
            if series:
                return series[-days:]
        except Exception:
            continue
    return []


def handle_history(symbols, days):
    safe_symbols = [
        symbol
        for symbol in symbols.split(",")
        if re.fullmatch(r"(sh|sz|hk|gb_)[A-Za-z0-9_]+", symbol)
    ]
    days = max(5, min(days, 60))
    histories = {}

    for symbol in safe_symbols:
        series = fetch_history_for_symbol(symbol, days)
        if series:
            histories[symbol] = series

    return {"histories": histories, "days": days}


def handle_intraday(symbols):
    safe_symbols = [
        symbol
        for symbol in symbols.split(",")
        if re.fullmatch(r"(sh|sz|hk|gb_)[A-Za-z0-9_]+", symbol)
    ]
    intraday = {}

    for symbol in safe_symbols:
        try:
            series = fetch_yahoo_history(symbol, 96, range_value="1d", interval="5m")
            if series:
                intraday[symbol] = series
        except Exception:
            continue

    return {"intraday": intraday}


def handle_rates():
    try:
        request = Request("https://api.frankfurter.app/latest?from=CNY&to=USD,HKD", headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
        return {
            "rates": {
                "USD_CNY": 1 / float(data["rates"]["USD"]),
                "HKD_CNY": 1 / float(data["rates"]["HKD"]),
            }
        }
    except Exception:
        return {"rates": FALLBACK_RATES}


def auth_enabled():
    return bool(os.environ.get("BASIC_AUTH_USER") and os.environ.get("BASIC_AUTH_PASSWORD"))


def expected_auth_header():
    raw = f'{os.environ.get("BASIC_AUTH_USER")}:{os.environ.get("BASIC_AUTH_PASSWORD")}'
    token = base64.b64encode(raw.encode("utf-8")).decode("ascii")
    return f"Basic {token}"


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urlparse(path).path.lstrip("/")
        return str(ROOT / path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def require_auth(self):
        if not auth_enabled():
            return True
        if self.headers.get("Authorization") == expected_auth_header():
            return True

        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Piggy Portfolio"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write("需要账号密码".encode("utf-8"))
        return False

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/healthz":
            self.send_json({"ok": True})
            return

        if not self.require_auth():
            return

        parsed = urlparse(self.path)
        if parsed.path == "/api/quotes":
            symbols = parse_qs(parsed.query).get("symbols", [""])[0]
            try:
                self.send_json(handle_quotes(symbols))
            except Exception as error:
                self.send_json({"quotes": {}, "error": str(error)}, 502)
            return

        if parsed.path == "/api/rates":
            self.send_json(handle_rates())
            return

        if parsed.path == "/api/history":
            symbols = parse_qs(parsed.query).get("symbols", [""])[0]
            raw_days = parse_qs(parsed.query).get("days", ["30"])[0]
            try:
                days = int(raw_days)
            except ValueError:
                days = 30
            try:
                self.send_json(handle_history(symbols, days))
            except Exception as error:
                self.send_json({"histories": {}, "error": str(error)}, 502)
            return

        if parsed.path == "/api/intraday":
            symbols = parse_qs(parsed.query).get("symbols", [""])[0]
            try:
                self.send_json(handle_intraday(symbols))
            except Exception as error:
                self.send_json({"intraday": {}, "error": str(error)}, 502)
            return

        super().do_GET()


if __name__ == "__main__":
    port = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", "8787"))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving http://{host}:{port}/")
    server.serve_forever()
