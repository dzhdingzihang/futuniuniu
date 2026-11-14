import { scanRadarMarket } from "../../functions/api/radar.js";
import { refreshRadarSnapshots } from "../../functions/lib/radar-snapshot.js";

export async function runScheduledRadarRefresh({
  env,
  fetcher = fetch,
  now = () => new Date(),
  scanMarket,
  recoveryOnly = false,
}) {
  if (!env?.RADAR_SNAPSHOTS) throw new TypeError("缺少 RADAR_SNAPSHOTS KV 绑定");
  const scanner = typeof scanMarket === "function"
    ? scanMarket
    : (market) => scanRadarMarket({ market, fetcher, now });
  return refreshRadarSnapshots({ kv: env.RADAR_SNAPSHOTS, scanMarket: scanner, now, recoveryOnly });
}

export function createRadarScheduler(refresh = runScheduledRadarRefresh) {
  return {
    scheduled(controller, env, context) {
      const scheduledTime = Number.isFinite(controller?.scheduledTime)
        ? controller.scheduledTime
        : Date.now();
      context.waitUntil(refresh({
        env,
        now: () => new Date(scheduledTime),
        recoveryOnly: controller?.cron === "40 0 * * *",
      }));
    },
  };
}

export default createRadarScheduler();
