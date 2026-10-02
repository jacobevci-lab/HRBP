import { handleOnboardingTaskPlanning } from "@/lib/onboarding-task-planning";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOnboardingTaskPlanning(request, params, "deadline");
}
