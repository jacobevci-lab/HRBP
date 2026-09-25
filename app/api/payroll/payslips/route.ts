import { can, forbidden } from "@/lib/authorization";
import { getPayrollSelfServiceData } from "@/lib/payroll-payslip-data";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:self-payslip")) return forbidden();
  if (!ctx.employmentId) return forbidden("Payroll self-service requires a signed employment identity.");

  try {
    const data = await getPayrollSelfServiceData(ctx);
    return Response.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "EMPLOYMENT_CONTEXT_REQUIRED") {
      return forbidden("Payroll self-service requires a valid employment identity in this tenant.");
    }
    throw error;
  }
}
