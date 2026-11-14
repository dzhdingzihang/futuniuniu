import directory from "../../assets/radar-universe.json" with {type:"json"};
import { loadSessionCalendar } from "../lib/intraday-session.js";
import { GROWTH_SEGMENTS } from "../lib/radar-segment.js";
import { PREOPEN_VERSION, readPreopenMarket } from "../lib/preopen-cycle.js";

export async function onRequestGet({env,now=()=>new Date(),fetcher=fetch}) {
  const asOf=now();
  const headers={"Cache-Control":"private, no-store"};
  if(!env?.RADAR_SNAPSHOTS) return Response.json({error:"盘前记录存储不可用"},{headers,status:503});
  try {
    const calendar=await loadSessionCalendar(fetcher,asOf);
    const boards=await Promise.all(Object.keys(GROWTH_SEGMENTS).map(m=>readPreopenMarket(env.RADAR_SNAPSHOTS,m,()=>asOf,calendar)));
    return Response.json({modelVersion:PREOPEN_VERSION,asOf:asOf.toISOString(),markets:Object.fromEntries(boards.map(b=>[b.market,{...b,total:b.total ?? directory[b.market]?.codes.length,membershipAsOf:directory[b.market]?.asOf}]))},{headers});
  } catch {
    return Response.json({error:"盘前冻结记录暂时无法读取。"},{headers,status:503});
  }
}
