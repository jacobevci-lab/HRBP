/** Fail-closed projection of authorized Action Center payroll metadata. */
export type ActionCenterPayrollTarget = "APPROVED" | "PAID";
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=191&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);

export function isActionCenterPayrollItem(item:unknown){
  if(!object(item)) return false;
  return item.kind==="payroll" ||
    (object(item.action) && (item.action.type==="approve-payroll" || item.action.type==="mark-payroll-paid"));
}

export function actionCenterPayrollControl(item:unknown):{runId:string;target:ActionCenterPayrollTarget}|null{
  if(!object(item)||item.kind!=="payroll"||item.secondaryAction!=null||!object(item.action)) return null;
  if(item.action.type==="approve-payroll"&&id(item.action.runId)) return {runId:item.action.runId,target:"APPROVED"};
  if(item.action.type==="mark-payroll-paid"&&id(item.action.runId)) return {runId:item.action.runId,target:"PAID"};
  return null;
}
