// Shared by the dashboard and the Pages Function. Stored lots contain their
// original accounting amounts. Only the returned display rows include the policy.
(() => {
  const referenceRates = { CNY: 1, HKD: 0.92, USD: 7.22 };

  function validate(policy) {
    for (const key of ["buyCny", "sellCny"]) {
      const amount = policy?.[key];
      if (typeof amount !== "number" || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))
          || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        throw new RangeError("成本规则 " + key + " 必须是非负人民币金额，最多两位小数");
      }
    }
    const normalized = { buyCny: policy.buyCny, sellCny: policy.sellCny };
    if (policy.lastOperationId !== undefined) {
      if (typeof policy.lastOperationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(policy.lastOperationId)) {
        throw new RangeError("成本规则的操作编号不正确");
      }
      normalized.lastOperationId = policy.lastOperationId;
    }
    return normalized;
  }

  function originalBuy(row) {
    return row.buyOperationId || row.parentLotId || row.lotId;
  }

  function assignShares(rows, amount, key) {
    const totalQty = rows.reduce((total, row) => total + row.qty, 0);
    const totalCents = Math.round(amount * 100);
    let cumulativeQty = 0;
    let assigned = 0;
    rows.forEach((row, index) => {
      cumulativeQty += row.qty;
      const cents = index === rows.length - 1 ? totalCents : Math.round(totalCents * cumulativeQty / totalQty);
      row[key] = (cents - assigned) / 100;
      assigned = cents;
    });
  }

  function baseAmount(row, side) {
    const isBuy = side === "buy";
    const locked = isBuy ? row.purchaseCostCny : row.sellProceedsCny;
    if (Number.isFinite(locked)) return locked;
    const price = isBuy ? row.cost : row.sellPrice;
    const native = price * row.qty * referenceRates[row.currency];
    const recordedFee = row[side + "FeeCny"];
    const fee = Number.isFinite(recordedFee) ? recordedFee : (row[side + "FeeUsd"] || 0) * referenceRates.USD;
    return isBuy ? native + fee : native - fee;
  }

  function apply(rows, rawPolicy) {
    if (rawPolicy === undefined) return rows;
    const policy = validate(rawPolicy);
    const groups = new Map();
    const result = rows.map((row) => {
      const copy = { ...row, adjustmentCny: 0, sellAdjustmentCny: 0 };
      // Excel v2 files from before the central policy stored a marked
      // adjustment inside the locked purchase cost.
      if (Number.isFinite(row.adjustmentCny) && Number.isFinite(row.purchaseCostCny)) {
        copy.purchaseCostCny -= row.adjustmentCny;
      }
      if (Number.isFinite(row.sellAdjustmentCny) && Number.isFinite(row.sellProceedsCny)) {
        copy.sellProceedsCny += row.sellAdjustmentCny;
      }
      const key = row.market + ":" + (row.sina || row.code);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(copy);
      return copy;
    });

    for (const group of groups.values()) {
      // A partially sold acquisition can have several FIFO fragments. Preserve
      // the importer's first-lot allocation when that acquisition is split.
      const first = group[0];
      const family = originalBuy(first);
      const buyRows = family ? group.filter((row) => originalBuy(row) === family) : [first];
      assignShares(buyRows, policy.buyCny, "adjustmentCny");
      const sales = group.filter((row) => row.status === "sold");
      if (sales.length) {
        // An imported aggregate has no operation ID. Dashboard-generated IDs
        // begin with the recording timestamp, keeping same-day FIFO splits
        // in their original event order even if their array positions change.
        const earliest = sales.reduce((firstSale, sale) => {
          const order = sale.sellDate.localeCompare(firstSale.sellDate)
            || (sale.sellOperationId || "").localeCompare(firstSale.sellOperationId || "");
          return order < 0 ? sale : firstSale;
        });
        const event = earliest.sellOperationId;
        const sellRows = event ? sales.filter((row) => row.sellOperationId === event) : [earliest];
        assignShares(sellRows, policy.sellCny, "sellAdjustmentCny");
      }
      for (const row of group) {
        row.purchaseCostCny = baseAmount(row, "buy") + row.adjustmentCny;
        if (row.status === "sold") row.sellProceedsCny = baseAmount(row, "sell") - row.sellAdjustmentCny;
      }
    }
    return result;
  }

  globalThis.PiggyHoldingCosts = Object.freeze({ apply, validate });
})();
