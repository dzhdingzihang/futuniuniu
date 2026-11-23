// Read-only provenance for closed sessions. Never expose unfinished pre-open stages.
import { intradaySession, loadSessionCalendar } from "../lib/intraday-session.js";
import { PREOPEN_VERSION, adjacentPreopenSession, preopenSampleMinutes } from "../lib/preopen-cycle.js";

const headers = {"Cache-Control":"private, no-store"};
function referenceSummary(reference, date) {
  return reference && reference.referenceDate === date ? {observedAt:reference.observedAt,validCount:reference.rows?.length,total:reference.total} : null;
}
const reply = (body, status=200) => Response.json(body, {status, headers});

export async function onRequestGet({request, env, now=()=>new Date(), fetcher=fetch}) {
  const params = new URL(request.url).searchParams;
  const market = params.get("market"), date = params.get("date");
  if (!["A股","港股","美股"].includes(market) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply({error:"市场或日期无效。"},400);
  const noon = Date.parse(date + "T12:00:00Z");
  if (!Number.isFinite(noon) || new Date(noon).toISOString().slice(0,10) !== date) return reply({error:"日期无效。"},400);
  if (!env?.RADAR_SNAPSHOTS) return reply({error:"存储不可用。"},503);
  try {
    const readAt = now();
    const calendar = await loadSessionCalendar(fetcher, readAt);
    const session = intradaySession(market,noon,calendar);
    if (!session.closeAt || Date.parse(session.closeAt) > +readAt) return reply({error:"仅可查询已收盘的交易日。"},400);
    const previous = adjacentPreopenSession(market,date,calendar,-1)?.tradeDate;
    const get = suffix => env.RADAR_SNAPSHOTS.get(PREOPEN_VERSION + ":" + market + ":" + suffix, "json");
    const archive = await get("frozen:" + date);
    const reference = previous ? await get("ref:" + previous) : null;
    const closingReference = await get("ref:" + date);
    const closingAttempt = closingReference ? null : await get("reference-attempt:" + date);
    const stages = [];
    for (const slot of preopenSampleMinutes) {
      const row = await get("stage:" + date + ":" + slot);
      if (row?.tradeDate === date) stages.push({slot,observedAt:row.observedAt || null,frozenAt:row.frozenAt || null,
        referenceDate:row.referenceDate || null,eligibleCount:row.coverage?.eligibleCount ?? null});
    }
    return reply({market,date,readAt:readAt.toISOString(),referenceDate:previous || null,
      reference:referenceSummary(reference,previous),closingReference:referenceSummary(closingReference,date),
      closingReferenceFailure:closingAttempt?.referenceDate===date && closingAttempt.stage==="reference"
        ? {at:closingAttempt.at,reason:closingAttempt.reason,counts:closingAttempt.counts || null} : null,
      stages,publishedAt:archive?.publishedAt || null,archiveStatus:archive?.status || null,
      captureDiagnostics:archive?.captureDiagnostics || null});
  } catch { return reply({error:"采集诊断暂时无法读取。"},503); }
}
