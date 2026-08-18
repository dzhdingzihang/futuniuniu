const FALLBACK_RATES = { USD_CNY: 7.22, HKD_CNY: 0.92 };

export async function onRequestGet({ fetcher = fetch, now = () => new Date() } = {}) {
  const fetchedAt = now().toISOString();
  try {
    const response = await fetcher("https://api.frankfurter.app/latest?from=CNY&to=USD,HKD", {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 0 },
    });
    if (!response.ok) throw new Error("rate source unavailable");

    const data = await response.json();
    const usdRate = Number(data?.rates?.USD);
    const hkdRate = Number(data?.rates?.HKD);
    if (!Number.isFinite(usdRate) || usdRate <= 0 || !Number.isFinite(hkdRate) || hkdRate <= 0) {
      throw new Error("invalid rate source payload");
    }

    return Response.json(
      {
        rates: {
          USD_CNY: 1 / usdRate,
          HKD_CNY: 1 / hkdRate,
        },
        asOf: /^\d{4}-\d{2}-\d{2}$/.test(data?.date || "") ? data.date : null,
        fetchedAt,
        source: "Frankfurter",
        fallback: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        rates: FALLBACK_RATES,
        asOf: null,
        fetchedAt,
        source: "固定参考汇率",
        fallback: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
