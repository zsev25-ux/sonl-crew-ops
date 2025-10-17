export type LeaderboardCategory = { key: string; label: string; field: string; higherIsBetter: boolean; };
export type CrewUser = { id: string; displayName: string; role: "crew"|"admin"|"owner"; photoURL?: string|null;
  stats?: { kudos?: number; bonuses?: number; onTimePct?: number; avgInstallMins?: number|null; }; };
export const defaultCategories: LeaderboardCategory[] = [
  { key: "bonuses", label: "Bonus Kings", field: "stats.bonuses", higherIsBetter: true },
  { key: "kudos", label: "Quality Captains", field: "stats.kudos", higherIsBetter: true },
  { key: "speed",  label: "Speed Demons",   field: "stats.onTimePct", higherIsBetter: true },
];
