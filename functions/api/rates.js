const FALLBACK_RATES = { USD_CNY: 7.22, HKD_CNY: 0.92 };

export async function onRequestGet() {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=CNY&to=USD,HKD", {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 0 },
    });
    if (!response.ok) throw new Error("rate source unavailable");

    const data = await response.json();
    return Response.json(
      {
        rates: {
          USD_CNY: 1 / Number(data.rates.USD),
          HKD_CNY: 1 / Number(data.rates.HKD),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { rates: FALLBACK_RATES },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
