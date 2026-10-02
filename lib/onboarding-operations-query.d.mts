import type { Prisma } from "@prisma/client";
export const ONBOARDING_PAGE_VERSION: 1;
export type OnboardingCursor = { date: string; id: string };
export type OnboardingOperationsQuery =
  | { mode: "list"; after: OnboardingCursor | null }
  | { mode: "focus"; planId?: string; taskId?: string };
export function operationIdentifier(value: unknown): string | null;
export function encodeOnboardingCursor(cursor: OnboardingCursor): string;
export function parseOnboardingCursor(raw: unknown): OnboardingCursor;
export function parseOnboardingOperationsQuery(search: URLSearchParams): OnboardingOperationsQuery;
export function onboardingOperationsPredicate(options: OnboardingOperationsQuery, tenantId: string): Prisma.OnboardingPlanWhereInput;
