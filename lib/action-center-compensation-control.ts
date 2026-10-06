type Action="APPROVE"|"REJECT"|"APPLY";
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=191&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
export function isActionCenterCompensationItem(item:unknown){if(!object(item))return false;return item.kind==="compensation"||(object(item.action)&&["approve-compensation","apply-compensation"].includes(String(item.action.type)))||(object(item.secondaryAction)&&item.secondaryAction.type==="reject-compensation");}
export function actionCenterCompensationControl(item:unknown):{changeId:string;allowedActions:Action[]}|null{
 if(!object(item)||item.kind!=="compensation")return null;let changeId:string|undefined;const allowedActions:Action[]=[];
 if(item.action!=null){if(!object(item.action)||!["approve-compensation","apply-compensation"].includes(String(item.action.type))||!id(item.action.changeId))return null;changeId=item.action.changeId;allowedActions.push(item.action.type==="approve-compensation"?"APPROVE":"APPLY");}
 if(item.secondaryAction!=null){if(!object(item.secondaryAction)||item.secondaryAction.type!=="reject-compensation"||!id(item.secondaryAction.changeId))return null;if(changeId&&changeId!==item.secondaryAction.changeId)return null;changeId=item.secondaryAction.changeId;allowedActions.push("REJECT");}
 return changeId&&allowedActions.length?{changeId,allowedActions}:null;
}