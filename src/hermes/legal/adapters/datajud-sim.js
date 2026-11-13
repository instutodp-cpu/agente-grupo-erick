const {normalizeProcessEvent}=require('../process-intelligence');
function mapDataJudMovement(input,context){
 if(!input||!context)throw new Error('missing_datajud_input');
 return normalizeProcessEvent({processId:context.processId,sourceId:'cnj_datajud',sourceSnapshotRef:context.sourceSnapshotRef,externalEventRef:input.id?String(input.id):null,eventType:input.nome||input.codigo||'unknown_movement',occurredAt:input.dataHora,description:input.complementosTabelados?JSON.stringify(input.complementosTabelados):null,contentScope:'metadata_only'});
}
module.exports={mapDataJudMovement};
