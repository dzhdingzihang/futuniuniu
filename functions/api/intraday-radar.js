import { MARKETS, INTRADAY_VERSION, readIntradayMarket } from "../lib/intraday-scan.js";
import { loadSessionCalendar } from "../lib/intraday-session.js";

export async function onRequestGet({env, now = () => new Date(), fetcher = fetch}) {
  const stamp = now();
  const headers = {"Cache-Control":"private, no-store"};
  if (!env.RADAR_SNAPSHOTS) return Response.json({error:"盘中行情存储暂不可用"},{status:503,headers});
  const calendar = await loadSessionCalendar(fetcher, stamp);
  try {
    const values = await Promise.all(MARKETS.map(m => readIntradayMarket(env.RADAR_SNAPSHOTS,m,stamp,calendar)));
    return Response.json({modelVersion:INTRADAY_VERSION,asOf:stamp.toISOString(),
      markets:Object.fromEntries(values.map(v => [v.market,v]))}, {headers});
  } catch {
    return Response.json({error:"盘中记录暂时读取失败，请稍后再试。"},{status:503,headers});
  }
}
