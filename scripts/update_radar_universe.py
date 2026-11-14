"""Refresh the three official radar membership lists together. An unchanged list keeps its revision date."""

import csv
import io
import json
import os
import re
import tempfile
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from openpyxl import load_workbook
from pypdf import PdfReader


OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "radar-universe.json"
SZSE = "https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1110&TABKEY=tab1&selectModule=nm"
NASDAQ = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
HSI_BASE = "https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1"
HSI_REPORTS = HSI_BASE + "/product-data/pub/series/metadata/v2?data=dailyReport&seriesCode=hstcis"
HSI_COUNTS = HSI_BASE + "/product-data/pub/constituent/metadata/v2?data=rt&seriesCode=hstcis&language=en-hk"
MARKET_CODES = {"A股": r"\d{6}", "港股": r"\d{5}", "美股": r"[A-Z0-9][A-Z0-9.-]{0,14}"}
HSI_ROWS = re.compile(
    r"\b(\d{8})\s+Hang\s+Seng\s+Technology\s+Composite\s+Index\s+"
    r"[恒恆]生科技綜合指數\s+(\d{1,5})\.HK\b", re.IGNORECASE,
)


def download(url):
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; RadarUniverse/1.0)"})
            with urlopen(request, timeout=40) as response:
                return response.read()
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def chinext():
    workbook = load_workbook(io.BytesIO(download(SZSE)), read_only=True, data_only=True)
    try:
        sheet = workbook["A股列表"]
        # SZSE exports a full table but sets its XLSX worksheet dimension to A1.
        sheet.reset_dimensions()
        rows = iter(sheet.values)
        header = list(next(rows))
        board = header.index("板块")
        symbol = header.index("A股代码")
        codes = [str(row[symbol]).strip() for row in rows if row[board] == "创业板"]
    finally:
        workbook.close()
    return {"source": SZSE, "codes": codes}


def hong_kong_tech():
    directory = json.loads(download(HSI_REPORTS))
    dates = next(report["reportDate"] for series in directory if series["seriesCode"] == "hstcis"
                 for report in series["reportList"] if report["reportType"] == "con-pdf-1")
    latest = max(dates, key=lambda item: date.fromisoformat(item["date"]))
    resource = latest["url"]
    if not resource.startswith("/public-website/") or not resource.endswith(".pdf"):
        raise ValueError("恒生成分报告地址无效")
    pdf_url = HSI_BASE + "/content/gcs/download?" + urlencode({"resource": resource})
    reader = PdfReader(io.BytesIO(download(pdf_url)))
    text = "\n".join(unicodedata.normalize("NFKC", page.extract_text()) for page in reader.pages)
    matches = HSI_ROWS.findall(text)
    dates_found = {datetime.strptime(trade_date, "%Y%m%d").date().isoformat() for trade_date, _ in matches}
    if dates_found != {latest["date"]}:
        raise ValueError("恒生科技综合指数成分表日期与报告目录不符")
    summary = json.loads(download(HSI_COUNTS))
    official_count = next(int(index["count"]) for index in summary["data"]["numOfConsList"]
                          if index["indexCode"] == "02297.00")
    codes = [code.zfill(5) for _, code in matches]
    if len(codes) != official_count or len(set(codes)) != official_count:
        raise ValueError(f"恒生科技综合指数官方数量为 {official_count}，报告唯一代码数为 {len(set(codes))}")
    return {"source": pdf_url, "sourceDate": latest["date"], "codes": codes}


# The issuer's name may contain "Unit", "Preferred" or "Equity". Nasdaq's security-type
# suffix after the final " - " identifies what is listed, independently of the issuer.
NON_EQUITY = re.compile(
    r"\b(?:warrants?|rights?|units?|preferred|preference|ETFs?|ETNs?|fund|notes?|bonds?|"
    r"debentures?|certificates?|limited partner interests?)\b", re.IGNORECASE,
)
EQUITY = re.compile(
    r"\b(?:common\s+(?:stock|shares?)|(?:ordinary|ord)\s+shares?|capital stock|"
    r"American Depos[io]t[ao]ry (?:shares?|receipts?)|ADSs?|ADRs?|"
    r"registered shares?|registry shares?|voting shares?|class [A-Z] shares?|"
    r"class [A-Z] (?:common|ordinary)$|shares? of beneficial interest)\b",
    re.IGNORECASE,
)


def nasdaq_equities():
    text = download(NASDAQ).decode("utf-8-sig").strip()
    last_line = text.splitlines()[-1]
    footer = re.fullmatch(r"File Creation Time:\s*(\d{8})\d{2}:\d{2}\|+", last_line)
    if not footer:
        raise ValueError("Nasdaq 文件缺少完整的发布日期尾行")
    source_date = datetime.strptime(footer.group(1), "%m%d%Y").date().isoformat()
    rows = csv.DictReader(io.StringIO(text), delimiter="|")
    if not {"Symbol", "Security Name", "ETF", "Test Issue", "NextShares"}.issubset(rows.fieldnames or []):
        raise ValueError("Nasdaq 证券目录缺少必要字段")
    codes = []
    for row in rows:
        if row["ETF"] != "N" or row["Test Issue"] != "N" or row["NextShares"] != "N":
            continue
        issuer, sep, instrument = row["Security Name"].strip().rpartition(" - ")
        if not sep or not issuer or NON_EQUITY.search(instrument) or not EQUITY.search(instrument):
            continue
        codes.append(row["Symbol"].strip().upper())
    return {"source": NASDAQ, "sourceDate": source_date, "codes": codes}


def validate(market, record, today):
    codes = record["codes"]
    if len(codes) < 200 or len(set(codes)) != len(codes) or not all(
        re.fullmatch(MARKET_CODES[market], code) for code in codes
    ):
        raise ValueError(f"{market} 名单数量、唯一性或代码格式未通过核验，共 {len(codes)} 条")
    if "sourceDate" in record and date.fromisoformat(record["sourceDate"]) > today:
        raise ValueError(f"{market} 的来源日期晚于核验日")
    record["codes"] = sorted(codes)


def main():
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    snapshot = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        downloads = {market: executor.submit(load) for market, load in (
            ("A股", chinext), ("港股", hong_kong_tech), ("美股", nasdaq_equities),
        )}
        for market, job in downloads.items():
            record = job.result()
            validate(market, record, today)
            prior = previous.get(market, {})
            if prior.get("sourceDate") and record.get("sourceDate", "") < prior["sourceDate"]:
                raise ValueError(f"{market} 上游来源日期早于当前已发布版本")
            # asOf is when this membership version was verified; sourceDate is the provider date if supplied.
            snapshot[market] = prior if record["codes"] == prior.get("codes") else {"asOf": today.isoformat(), **record}
            print(f"{market} 核验 {len(record['codes'])} 只，名单版本 {snapshot[market]['asOf']}")
    if snapshot != previous:
        temp = tempfile.NamedTemporaryFile("w", dir=OUTPUT.parent, delete=False, encoding="utf-8")
        try:
            with temp:
                json.dump(snapshot, temp, ensure_ascii=False, indent=2)
                temp.write("\n")
            os.chmod(temp.name, 0o644)
            os.replace(temp.name, OUTPUT)
        finally:
            Path(temp.name).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
