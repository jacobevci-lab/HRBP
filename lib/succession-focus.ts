type ScopedSuccessionPlan = {
  id: string;
  ownerId: string | null;
  candidates: readonly { id: string }[];
};

/**
 * Both plan review and candidate evidence deep links must be matched inside
 * the same already-tenant/relationship-scoped plan collection. The action
 * center focus remains owner-bound; an arbitrary URL cannot widen access.
 */
export function isOwnedSuccessionFocus(
  plan: ScopedSuccessionPlan,
  focusId: string,
  actorId: string
): boolean {
  return plan.ownerId === actorId &&
    (plan.id === focusId || plan.candidates.some((candidate) => candidate.id === focusId));
}
