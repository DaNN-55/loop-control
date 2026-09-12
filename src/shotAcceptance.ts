export function nextUnconfirmedShotId(shotIds: string[], currentShotId: string, confirmedShotIds: ReadonlySet<string>): string | null {
  const currentIndex = shotIds.indexOf(currentShotId);
  if (currentIndex < 0) return shotIds.find((shotId) => !confirmedShotIds.has(shotId)) ?? null;
  const orderedCandidates = [...shotIds.slice(currentIndex + 1), ...shotIds.slice(0, currentIndex)];
  return orderedCandidates.find((shotId) => !confirmedShotIds.has(shotId)) ?? null;
}
