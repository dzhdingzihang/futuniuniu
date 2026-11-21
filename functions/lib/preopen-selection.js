// The archive lifecycle ("frozen") does not establish how much of the market was tested.
export function classifyPreopenSelection(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.candidates)) return "unavailable";
  if (snapshot.status === "frozen" && snapshot.candidates.length) return "qualified";
  const c = snapshot.coverage;
  if (!c) return snapshot.status === "frozen" ? "incomplete" : "unavailable";
  if (snapshot.status === "frozen" && snapshot.total > 0 && c.referenceCount === snapshot.total &&
      c.missingReferenceCount === 0 && c.unresolvedCount === 0 && c.qualifyingCount === 0 &&
      Number.isInteger(c.eligibleCount) && c.eligibleCount >= 0 && c.eligibleCount <= c.referenceCount &&
      Number.isInteger(c.confirmedMissCount) && c.confirmedMissCount >= 0 &&
      Number.isInteger(c.jumpedCount) && c.jumpedCount >= 0 &&
      c.confirmedMissCount + c.jumpedCount === c.eligibleCount) return "confirmed_empty";
  return "incomplete";
}
