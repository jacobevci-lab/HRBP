/** Fail-closed projection of authorized Action Center compensation metadata. */
type Action = "APPROVE" | "REJECT" | "APPLY";
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=191&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);

export function isActionCenterCompensationItem(item:unknown){
  if(!object(item)) return false;
  return item.kind==="compensation" ||
    (object(item.action) && (item.action.type==="approve-compensation" || item.action.type==="apply-compensation")) ||
    (object(item.secondaryAction) && item.secondaryAction.type==="reject-compensation");
}

export function actionCenterCompensationControl(item:unknown):{changeId:string;allowedActions:Action[]}|null{
  if(!object(item)||item.kind!=="compensation") return null;
  let changeId:string|undefined;
  const allowedActions:Action[]=[];
  if(item.action!=null){
    if(!object(item.action)||!id(item.action.changeId)) return null;
    if(item.action.type==="approve-compensation") allowedActions.push("APPROVE");
    else if(item.action.type==="apply-compensation") allowedActions.push("APPLY");
    else return null;
    changeId=item.action.changeId;
  }
  if(item.secondaryAction!=null){
    if(!object(item.secondaryAction)||item.secondaryAction.type!=="reject-compensation"||!id(item.secondaryAction.changeId)) return null;
    if(changeId!==undefined&&changeId!==item.secondaryAction.changeId) return null;
    changeId=item.secondaryAction.changeId;
    allowedActions.push("REJECT");
  }
  if(!changeId||!allowedActions.length) return null;
  if(allowedActions.includes("APPLY")&&allowedActions.length!==1) return null;
  return {changeId,allowedActions};
}
