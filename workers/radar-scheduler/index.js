import { runPreopenCycle } from "../../functions/lib/preopen-cycle.js";
import { intradaySession } from "../../functions/lib/intraday-session.js";
import { runIntradayScan } from "../../functions/lib/intraday-scan.js";
import { scanRadarWithSegment } from "../../functions/api/radar.js";
import { loadGrowthDirectory } from "../../functions/lib/radar-segment.js";
import { refreshRadarSnapshots } from "../../functions/lib/radar-snapshot.js";

export async function runScheduledRadarRefresh({
  env,
  fetcher = fetch,
  now = () => new Date(),
  scanMarket,
  recoveryOnly = false,
}) {
  if (!env?.RADAR_SNAPSHOTS) throw new TypeError("缺少 RADAR_SNAPSHOTS KV 绑定");
  let directory;
  const scanner = typeof scanMarket === "function"
    ? scanMarket
    : (market, previous) => {
      directory ??= loadGrowthDirectory(fetcher, 8000);
      return scanRadarWithSegment({ market, fetcher, now, directory }, previous);
    };
  return refreshRadarSnapshots({ kv: env.RADAR_SNAPSHOTS, scanMarket: scanner, now, recoveryOnly });
}

export function createRadarScheduler(refresh = runScheduledRadarRefresh, scanIntraday = runIntradayScan, preopen = runPreopenCycle) {
  return {
    scheduled(controller, env, context) {
      const scheduledTime = Number.isFinite(controller?.scheduledTime)
        ? controller.scheduledTime
        : Date.now();
      const scheduledAt = new Date(scheduledTime);
      const hour = scheduledAt.getUTCHours(), minute = scheduledAt.getUTCMinutes();
      const weekday = scheduledAt.getUTCDay() % 6 !== 0;
      if (hour === 0 && (minute === 10 || minute === 40)) {
        context.waitUntil(refresh({env, now: () => scheduledAt, recoveryOnly: minute === 40}));
        return;
      }
      const jobs = [];
      if (weekday && minute % 5 === 0) jobs.push(scanIntraday({env, scheduledAt}));
      // The US cron spans both UTC offsets. Only the 09:23 New York tick needs a scan.
      const sampleAt0923 = minute === 23 && (hour === 1 ||
        ([13,14].includes(hour) && intradaySession("美股", scheduledAt).localMinute === 563));
      const beforeOpen = weekday && (sampleAt0923 ||
        ([1,13,14].includes(hour) && [10,15,20,22,24,25,28].includes(minute)));
      const afterClose = ([4,7,8,17,18,20,21].includes(hour) && [35,55].includes(minute))
        || (weekday && ((hour===8 && minute===45) || (hour===9 && minute===35) || (hour===13 && [35,55].includes(minute))));
      if (beforeOpen || afterClose) jobs.push(preopen({env, scheduledAt}));
      context.waitUntil(Promise.all(jobs));
    },
  };
}

export default createRadarScheduler();
