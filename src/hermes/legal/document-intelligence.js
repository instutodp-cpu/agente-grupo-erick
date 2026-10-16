const {sha256}=require('./provenance');
function createFragment({documentId,versionId,text,locator,extractionMethod='unknown',confidence=0,sourceSnapshotRef=null}){
 if(!documentId||!versionId||text==null||!locator?.kind||!locator?.value) throw new Error('incomplete_document_fragment');
 const hash=sha256(text);
 return Object.freeze({fragment_id:'fragment:'+hash,document_id:documentId,version_id:versionId,text,content_hash:hash,locator,extraction_method:extractionMethod,confidence,source_snapshot_ref:sourceSnapshotRef});
}
function classifyExtraction(fragment){
 if(!fragment)return {usable:false,reason:'missing_fragment'};
 if(fragment.extraction_method==='ocr'&&fragment.confidence<0.9)return {usable:false,reason:'low_confidence_ocr'};
 if(fragment.extraction_method==='unknown')return {usable:false,reason:'unknown_extraction_method'};
 return {usable:true,reason:'traceable_extraction'};
}
function compareVersions(oldFragments,newFragments){
 const oldByLocator=new Map((oldFragments||[]).map(f=>[f.locator.kind+':'+f.locator.value,f]));
 const newByLocator=new Map((newFragments||[]).map(f=>[f.locator.kind+':'+f.locator.value,f]));
 const keys=[...new Set([...oldByLocator.keys(),...newByLocator.keys()])].sort();
 return keys.map(key=>{const a=oldByLocator.get(key),b=newByLocator.get(key);if(!a)return {locator:key,change:'added',before:null,after:b.content_hash};if(!b)return {locator:key,change:'removed',before:a.content_hash,after:null};if(a.content_hash!==b.content_hash)return {locator:key,change:'modified',before:a.content_hash,after:b.content_hash};return {locator:key,change:'unchanged',before:a.content_hash,after:b.content_hash};});
}
function assertMatterIsolation(document,matterScope){return document?.matter_scope===matterScope?{allowed:true,reason:'matter_scope_match'}:{allowed:false,reason:'matter_scope_mismatch'};}
module.exports={createFragment,classifyExtraction,compareVersions,assertMatterIsolation};
