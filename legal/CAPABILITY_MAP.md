# Hermes Legal Capability Map v1

J01 freezes the domain taxonomy before provider adapters exist.

| Family | Target count | Foundation examples |
|---|---:|---|
| research-authority | 12 | authority.search, authority.retrieve, authority.verify, authority.temporal_check, precedent.search |
| matter-management | 7 | matter.open, matter.classify, matter.link_party |
| document-intelligence | 10 | document.ingest, document.classify, document.extract, document.compare, document.redline |
| contract-intelligence | 13 | contract.ingest, contract.extract_clauses, contract.extract_obligations, contract.assess_risk |
| process-intelligence | 9 | process.search, process.retrieve, process.timeline, process.detect_movement |
| deadline-obligation | 7 | deadline.detect, deadline.calculate, deadline.validate, obligation.monitor |
| drafting | 8 | draft.contract, draft.notice, draft.opinion |
| review-risk | 8 | review.independent, risk.assess, inconsistency.detect |
| compliance | 7 | compliance.lgpd, compliance.consumer, compliance.labor |
| corporate-legal | 5 | corporate.act_review, power_of_attorney.review |
| litigation | 5 | litigation.strategy, litigation.evidence_map, litigation.filing_prepare |
| executive-intelligence | 5 | executive.exposure, executive.portfolio, executive.report |
| **Total** | **96** | |

## First activation candidates
The first implementation wave remains read/analysis oriented:
legal.authority.search; legal.authority.retrieve; legal.authority.verify; legal.authority.temporal_check; legal.precedent.search; legal.precedent.retrieve; legal.precedent.compare; legal.document.ingest; legal.document.classify; legal.document.extract; legal.document.compare; legal.contract.ingest; legal.contract.extract_clauses; legal.contract.extract_obligations; legal.contract.assess_risk; legal.contract.compare_playbook; legal.process.search; legal.process.retrieve; legal.process.timeline; legal.process.detect_movement; legal.evidence.build; legal.evidence.verify; legal.opinion.prepare.

All are planned in J01. None has a real provider handler in J01.
