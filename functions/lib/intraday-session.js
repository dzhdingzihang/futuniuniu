import bundledCalendar from "../../assets/radar-calendar.json" with { type: "json" };

const zones = { "A股": "Asia/Shanghai", "港股": "Asia/Hong_Kong", "美股": "America/New_York" };
const formatters = Object.fromEntries(Object.entries(zones).map(([market, timeZone]) => [
  market, new Intl.DateTimeFormat("en-CA", {timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}),
]));
let calendarCache;

export async function loadSessionCalendar(fetcher = fetch, now = new Date()) {
  if (calendarCache && Number(now) - calendarCache.time < 6 * 3600000 && Number(now) >= calendarCache.time) return calendarCache.data;
  try {
    const res = await fetcher("https://alixjd.com/assets/radar-calendar.json", {signal:AbortSignal.timeout(4500), cf:{cacheTtl:1800}});
    if (!res.ok) throw Error("calendar HTTP " + res.status);
    const data = await res.json();
    if (!Object.keys(zones).every(m => data[m]?.through >= bundledCalendar[m].through && Array.isArray(data[m]?.holidays) && data[m]?.earlyCloses)) throw Error("calendar coverage");
    calendarCache = {data, time:Number(now)};
    return data;
  } catch { return calendarCache?.data || bundledCalendar; }
}

export function intradaySession(market, now = new Date(), calendar = bundledCalendar) {
  const date = new Date(now);
  const parts = Object.fromEntries(formatters[market].formatToParts(date).map(p => [p.type,p.value]));
  const tradeDate = [parts.year, parts.month, parts.day].join("-");
  const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = new Date(tradeDate + "T12:00:00Z").getUTCDay();
  const rules = calendar[market];
  const known = rules && tradeDate >= rules.from && tradeDate <= rules.through;
  const tradingDay = known && weekday !== 0 && weekday !== 6 && !rules.holidays.includes(tradeDate);
  const end = rules?.earlyCloses?.[tradeDate] ?? (market === "A股" ? 900 : 960);
  const intervals = market === "美股" ? [[570,end,"us"]]
    : [[570,Math.min(end, market === "A股" ? 690 : 720),"am"], ...(end > 780 ? [[780,end,"pm"]] : [])];
  const minutesInSession = intervals.reduce((n,[start,stop]) => n + stop-start,0);
  const elapsedMinutes = intervals.reduce((n,[start,stop]) => n + Math.max(0,Math.min(localMinute,stop)-start),0);
  const current = intervals.find(([start,stop]) => localMinute >= start && localMinute < stop);
  const phase = !tradingDay ? "holiday" : current ? "trading" : localMinute < 570 ? "preopen" : localMinute >= end ? "closed" : "break";
  const minuteToIso = minute => new Date(Math.floor(date.getTime()/60000)*60000 + (minute-localMinute)*60000).toISOString();
  return { tradeDate, zone:zones[market], phase, calendarKnown:Boolean(known), localMinute,
    sessionKey:tradingDay ? current?.[2] || null : null, elapsedMinutes,
    remainingMinutes:minutesInSession-elapsedMinutes, sessionStartAt:tradingDay && current ? minuteToIso(current[0]) : null,
    closeAt:tradingDay ? minuteToIso(end) : null };
}
