'use strict';

const INVENTORY_MOVEMENT_TYPES=Object.freeze([
 'OPENING','PURCHASE','TRANSFER_IN','CUSTOMER_RETURN','POSITIVE_ADJUSTMENT',
 'SALE','TRANSFER_OUT','SUPPLIER_RETURN','LOSS_DAMAGE','NEGATIVE_ADJUSTMENT'
]);
const RECEIPT_STATUSES=Object.freeze(['COMPLETE','PARTIAL','OVER_RECEIVED','REJECTED']);
const TRANSFER_STATUSES=Object.freeze(['CREATED','DISPATCHED','IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','CONFLICT']);

function int(v,f,{nonNegative=false}={}){
 if(!Number.isSafeInteger(v)||(nonNegative&&v<0)) throw new Error(`${f} must be a ${nonNegative?'non-negative ':''}safe integer`);
}
function createInventoryMovement(i={}){
 for(const f of ['movementId','tenantId','companyId','establishmentId','sku','movementType','quantityMilliUnits','occurredAt']) if(i[f]===undefined||i[f]===null||i[f]==='') throw new Error(`${f} is required`);
 if(!INVENTORY_MOVEMENT_TYPES.includes(i.movementType)) throw new Error('unsupported inventory movement type');
 int(i.quantityMilliUnits,'quantityMilliUnits',{nonNegative:true});
 if(i.unitCostCents!=null) int(i.unitCostCents,'unitCostCents',{nonNegative:true});
 return Object.freeze({...i,evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function rollForward(openingMilliUnits,movements=[]){
 int(openingMilliUnits,'openingMilliUnits');
 const plus=new Set(['PURCHASE','TRANSFER_IN','CUSTOMER_RETURN','POSITIVE_ADJUSTMENT']);
 const minus=new Set(['SALE','TRANSFER_OUT','SUPPLIER_RETURN','LOSS_DAMAGE','NEGATIVE_ADJUSTMENT']);
 return movements.reduce((q,m)=>q+(plus.has(m.movementType)?m.quantityMilliUnits:minus.has(m.movementType)?-m.quantityMilliUnits:0),openingMilliUnits);
}
function assessGoodsReceipt({orderedMilliUnits,receivedMilliUnits,rejected=false}){
 int(orderedMilliUnits,'orderedMilliUnits',{nonNegative:true}); int(receivedMilliUnits,'receivedMilliUnits',{nonNegative:true});
 if(rejected) return 'REJECTED';
 if(receivedMilliUnits===orderedMilliUnits) return 'COMPLETE';
 if(receivedMilliUnits<orderedMilliUnits) return 'PARTIAL';
 return 'OVER_RECEIVED';
}
function reconcilePurchaseFiveWay(c={}){
 const required=['purchaseOrderMatched','fiscalDocumentMatched','goodsReceiptMatched','payableMatched','inventoryMatched'];
 const failed=required.filter(k=>c[k]!==true);
 return Object.freeze({status:failed.length?'NEEDS_REVIEW':'MATCHED',failedChecks:Object.freeze(failed)});
}
function reconcileInventory({theoreticalMilliUnits,physicalMilliUnits,erpMilliUnits}){
 [theoreticalMilliUnits,physicalMilliUnits,erpMilliUnits].forEach((v,n)=>int(v,['theoreticalMilliUnits','physicalMilliUnits','erpMilliUnits'][n]));
 return Object.freeze({
  theoreticalMilliUnits,physicalMilliUnits,erpMilliUnits,
  physicalVarianceMilliUnits:physicalMilliUnits-theoreticalMilliUnits,
  erpVarianceMilliUnits:erpMilliUnits-theoreticalMilliUnits,
  status:physicalMilliUnits===theoreticalMilliUnits&&erpMilliUnits===theoreticalMilliUnits?'MATCHED':'NEEDS_REVIEW'
 });
}
function createTransfer(i={}){
 for(const f of ['transferId','sku','fromEstablishmentId','toEstablishmentId','dispatchedMilliUnits']) if(i[f]===undefined||i[f]===null||i[f]==='') throw new Error(`${f} is required`);
 if(i.fromEstablishmentId===i.toEstablishmentId) throw new Error('transfer establishments must differ');
 int(i.dispatchedMilliUnits,'dispatchedMilliUnits',{nonNegative:true});
 const received=i.receivedMilliUnits??0; int(received,'receivedMilliUnits',{nonNegative:true});
 const status=received===0?'IN_TRANSIT':received===i.dispatchedMilliUnits?'RECEIVED':received<i.dispatchedMilliUnits?'PARTIALLY_RECEIVED':'CONFLICT';
 return Object.freeze({...i,receivedMilliUnits:received,status});
}
function lossSignal(input={}){
 return Object.freeze({signalType:'INVENTORY_VARIANCE',severity:input.severity??'MEDIUM',requiresHumanReview:true,fraudConclusion:false,evidenceIds:Object.freeze([...(input.evidenceIds??[])])});
}
module.exports={INVENTORY_MOVEMENT_TYPES,RECEIPT_STATUSES,TRANSFER_STATUSES,createInventoryMovement,rollForward,assessGoodsReceipt,reconcilePurchaseFiveWay,reconcileInventory,createTransfer,lossSignal};
