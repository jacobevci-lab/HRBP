type Action="APPROVED"|"PAID";
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=191&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
export function isActionCenterPayrollItem(item:unknown){if(!object(item))return false;return item.kind==="payroll"||(object(item.action)&&["approve-payroll","mark-payroll-paid"].includes(String(item.action.type)));}
export function actionCenterPayrollControl(item:unknown):{runId:string;action:Action}|null{
 if(!object(item)||item.kind!=="payroll"||item.secondaryAction!=null||!object(item.action)||!id(item.action.runId))return null;
 if(item.action.type==="approve-payroll")return{runId:item.action.runId,action:"APPROVED"};
 if(item.action.type==="mark-payroll-paid")return{runId:item.action.runId,action:"PAID"};
 return null;
}