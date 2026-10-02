export function serviceSlaPolicy(now: Date, warningMinutes?: number, severeMinutes?: number): {
  where: { OR: Array<{ escalationLevel: { lt: number }; slaDueAt: { lte: Date } }> };
  target(dueAt: Date): { level: number; reason: string };
};
