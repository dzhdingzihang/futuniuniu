"""Capture dated industry classifications for the three radar membership lists."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ASSETS = Path(__file__).resolve().parents[1] / "assets"
FILE = ASSETS / "radar-industries.json"
MARKETS = {"A股": ("china", "SZSE"), "港股": ("hongkong", "HKEX"), "美股": ("america", "NASDAQ")}


def read_market(market, codes):
    country, exchange = MARKETS[market]
    url = f"https://scanner.tradingview.com/{country}/scan"
    symbols = {f"{exchange}:{int(code) if market == '港股' else code}": code for code in codes}
    body = json.dumps({"symbols": {"tickers": list(symbols)}, "columns": ["industry"],
                       "range": [0, len(symbols)]}).encode()
    req = Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0",
                                           "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"})
    with urlopen(req, timeout=30) as result:
        records = json.load(result)["data"]
    groups = {}
    seen = set()
    for row in records:
        code = symbols.get(row["s"])
        industry = row["d"][0]
        if code and code not in seen and isinstance(industry, str) and industry:
            groups.setdefault(industry, []).append(code)
            seen.add(code)
    if len(seen) < 0.9 * len(codes):
        raise ValueError(f"{market} industry coverage {len(seen)}/{len(codes)}")
    return {"source": url, "groups": {name: sorted(tickers) for name, tickers in sorted(groups.items())}}


def main():
    membership = json.loads((ASSETS / "radar-universe.json").read_text())
    old = json.loads(FILE.read_text()) if FILE.exists() else {}
    now = datetime.now(timezone.utc)
    with ThreadPoolExecutor(max_workers=3) as pool:
        tasks = {market: pool.submit(read_market, market, membership[market]["codes"]) for market in MARKETS}
        markets = {market: task.result() for market, task in tasks.items()}
    if old.get("markets") == markets and now - datetime.fromisoformat(old["observedAt"]) < timedelta(days=7):
        return
    data = {"observedAt": now.isoformat(timespec="seconds"), "markets": markets}
    temp = FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(temp, FILE)
    print("行业分类已更新", {key: sum(map(len, market["groups"].values())) for key, market in markets.items()})


if __name__ == "__main__":
    main()
