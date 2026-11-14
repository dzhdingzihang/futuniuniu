"""Publish market-calendar exceptions for the current and following year."""
import json
from datetime import date, timedelta
from pathlib import Path

import exchange_calendars as xc

OUTPUT = Path(__file__).resolve().parents[1] / "assets/radar-calendar.json"
# SZSE and SSE share the mainland stock holiday schedule. Regular Nasdaq and
# NYSE equity sessions share US market holidays and early closing times.
MARKETS = {"A股": ("XSHG", "Asia/Shanghai", 900),
           "港股": ("XHKG", "Asia/Hong_Kong", 960),
           "美股": ("XNYS", "America/New_York", 960)}


def main():
    first = date(date.today().year, 1, 1)
    result = {}
    for market, (code, zone, normal_close) in MARKETS.items():
        limit = date(first.year + 1, 12, 31)
        bound = xc.get_calendar(code).bound_max()
        if bound is not None:
            limit = min(limit, bound.date())
        cal = xc.get_calendar(code, start=first.isoformat(), end=limit.isoformat())
        if limit < date.today():
            raise ValueError(f"{code} calendar has expired")
        closes = {d.date(): value.tz_convert(zone) for d, value in cal.schedule.close.items()}
        holidays, half_days = [], {}
        day = first
        while day <= limit:
            if day.weekday() < 5:
                if day not in closes:
                    holidays.append(day.isoformat())
                else:
                    minute = closes[day].hour * 60 + closes[day].minute
                    if minute != normal_close:
                        half_days[day.isoformat()] = minute
            day += timedelta(days=1)
        result[market] = {"from": first.isoformat(), "through": limit.isoformat(),
                          "holidays": holidays, "earlyCloses": half_days}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
