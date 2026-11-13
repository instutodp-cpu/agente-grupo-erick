const test=require('node:test');const assert=require('node:assert/strict');
const {assessAuthorityAt,detectAuthorityConflict}=require('../src/hermes/legal/authority-temporal');
const base={authority_id:'law-1',authority_type:'law',jurisdiction:'BR',issuer:'Federal',identifier:'1',publication_date:'2025-01-01',effective_from:'2025-02-01',effective_until:null,status:'effective',supersedes:[],superseded_by:[],source_snapshot_ref:'snap-1'};
test('future unpublished authority is rejected',()=>assert.equal(assessAuthorityAt(base,'2024-12-31').reason,'not_published_at_date'));
test('published but not effective authority is rejected',()=>assert.equal(assessAuthorityAt(base,'2025-01-15').reason,'not_yet_effective'));
test('effective authority applies inside temporal window',()=>assert.equal(assessAuthorityAt(base,'2025-03-01').applicable,true));
test('authority after explicit end of effectiveness is rejected',()=>assert.equal(assessAuthorityAt({...base,effective_until:'2026-01-31',status:'revoked'},'2026-02-01').reason,'no_longer_effective'));
test('revoked authority without temporal boundary fails closed',()=>assert.equal(assessAuthorityAt({...base,status:'revoked'},'2025-03-01').reason,'terminal_status_without_temporal_boundary'));
test('unknown authority status fails closed',()=>assert.equal(assessAuthorityAt({...base,status:'unknown'},'2025-03-01').reason,'authority_status_unknown'));
test('overlapping successor and predecessor is surfaced as conflict',()=>{
 const old={...base,authority_id:'old'};
 const newer={...base,authority_id:'new',publication_date:'2025-02-01',effective_from:'2025-03-01',supersedes:['old']};
 const result=detectAuthorityConflict([old,newer],'2025-04-01');
 assert.equal(result.applicable.length,2);assert.ok(result.conflicts.length>=1);
});
