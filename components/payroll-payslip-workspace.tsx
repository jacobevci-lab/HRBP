import { BadgeDollarSign, CalendarDays, CheckCircle2, FileText, LockKeyhole, ReceiptText, ShieldCheck } from "lucide-react";
import type { PayrollPayslipData } from "@/lib/payroll-payslip-data";

function money(currency: string, value: string | null) {
  if (value === null) return "—";
  const amount = Number(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function day(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function lineType(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function PayrollPayslipWorkspace({ data }: { data: PayrollPayslipData }) {
  const latest = data.payslips[0];

  return <div className="workpay-shell">
    <section className="workpay-metrics">
      <div className="workpay-metric card"><div className="workpay-metric-icon"><ReceiptText size={18}/></div><div><span>Available statements</span><strong>{data.payslips.length}</strong><small>Approved or paid payroll only</small></div></div>
      <div className="workpay-metric card"><div className="workpay-metric-icon"><BadgeDollarSign size={18}/></div><div><span>Latest net pay</span><strong>{latest ? money(latest.currency, latest.netPay) : "—"}</strong><small>{latest ? latest.periodCode : "No released payroll"}</small></div></div>
      <div className="workpay-metric card"><div className="workpay-metric-icon"><CalendarDays size={18}/></div><div><span>Latest pay date</span><strong>{latest ? day(latest.payDate) : "—"}</strong><small>{latest ? `${latest.countryCode} · pack ${latest.packVersion}` : "No released payroll"}</small></div></div>
      <div className="workpay-metric card"><div className="workpay-metric-icon"><LockKeyhole size={18}/></div><div><span>Access boundary</span><strong>Self only</strong><small>Signed employment identity required</small></div></div>
    </section>

    <section className="card workpay-panel" style={{ marginTop: 14 }}>
      <div className="workpay-panel-head"><div><span className="section-kicker">Employee payroll self-service</span><h3>{data.employee.name}</h3><p style={{ margin: "4px 0 0" }}>{data.employee.employeeNumber} · {data.employee.position} · {data.employee.organization}</p></div><ShieldCheck size={20}/></div>
      <div className="control-stack" style={{ marginTop: 12 }}>
        <div><ShieldCheck size={17}/><span><strong>Released statements only</strong><small>Draft, validating, calculated and exception payroll results are never exposed to employee self-service.</small></span></div>
        <div><LockKeyhole size={17}/><span><strong>Employment-bound access</strong><small>The server pins every query to the employment identifier inside the signed session. A caller cannot request another employee&apos;s payroll result.</small></span></div>
        <div><CheckCircle2 size={17}/><span><strong>Restricted audit trail</strong><small>Opening payroll self-service records a restricted audit event for the signed employment.</small></span></div>
      </div>
    </section>

    <section style={{ display: "grid", gap: 12, marginTop: 14 }}>
      {data.payslips.length ? data.payslips.map((payslip, index) => <details className="card workpay-panel" key={payslip.id} open={index === 0}>
        <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div><span className="section-kicker">{payslip.status === "PAID" ? "Paid payroll statement" : "Approved payroll statement"}</span><h3 style={{ margin: "5px 0 2px" }}>{payslip.periodCode}</h3><small>{day(payslip.periodStart)} → {day(payslip.periodEnd)} · Pay date {day(payslip.payDate)} · {payslip.country}</small></div>
          <div style={{ textAlign: "right" }}><strong style={{ display: "block", fontSize: 18 }}>{money(payslip.currency, payslip.netPay)}</strong><small>Net pay</small></div>
        </summary>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 16 }}>
          <div className="mini-rule"><span>Gross</span><strong>{money(payslip.currency, payslip.grossPay)}</strong></div>
          <div className="mini-rule"><span>Taxable</span><strong>{money(payslip.currency, payslip.taxablePay)}</strong></div>
          <div className="mini-rule"><span>Tax</span><strong>{money(payslip.currency, payslip.taxAmount)}</strong></div>
          <div className="mini-rule"><span>Deductions</span><strong>{money(payslip.currency, payslip.deductions)}</strong></div>
        </div>

        <div className="workpay-table-wrap" style={{ marginTop: 14 }}><table className="workpay-table"><thead><tr><th>Type</th><th>Code / description</th><th>Quantity</th><th>Rate</th><th>Taxable</th><th>Amount</th></tr></thead><tbody>{payslip.lineItems.length ? payslip.lineItems.map((line) => <tr key={line.id}><td>{lineType(line.type)}</td><td><strong>{line.code}</strong><small className="cell-sub">{line.label}</small></td><td>{line.quantity ?? "—"}</td><td>{line.rate ? money(payslip.currency, line.rate) : "—"}</td><td>{line.taxable ? "Yes" : "No"}</td><td><strong>{money(payslip.currency, line.amount)}</strong></td></tr>) : <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>No payroll line items were released with this statement.</td></tr>}</tbody></table></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}><small><FileText size={13} style={{ verticalAlign: "-2px", marginRight: 5 }}/>Result {payslip.id} · calculated {day(payslip.calculatedAt)}</small><small>{payslip.paidAt ? `Paid ${day(payslip.paidAt)}` : `Approved ${day(payslip.approvedAt)}`}</small></div>
      </details>) : <section className="card module-table"><div className="empty-state"><ReceiptText size={24}/><h3>No released payroll statements yet</h3><p>Your self-service page only shows payroll results after they have reached the governed approval or payment state.</p></div></section>}
    </section>
  </div>;
}
