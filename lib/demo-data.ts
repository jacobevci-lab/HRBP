export const employees = [
  { id:"EMP-1042", initials:"AK", name:"Aylin Kaya", role:"Engineering Director", department:"Engineering", manager:"Mert Demir", location:"Istanbul", status:"Active", start:"12 Mar 2021", position:"ENG-DIR-01", classification:"Confidential" },
  { id:"EMP-1178", initials:"CY", name:"Can Yildiz", role:"Senior Product Manager", department:"Product", manager:"Aylin Kaya", location:"Berlin", status:"Active", start:"04 Sep 2023", position:"PRD-SPM-03", classification:"Confidential" },
  { id:"EMP-1211", initials:"EK", name:"Elif Karaca", role:"People Partner", department:"People", manager:"Selin Arslan", location:"Istanbul", status:"Active", start:"18 Jan 2024", position:"PPL-HRBP-02", classification:"Confidential" },
  { id:"EMP-1256", initials:"MB", name:"Mehmet Bal", role:"Security Architect", department:"Security", manager:"Deniz Aksoy", location:"Amsterdam", status:"Probation", start:"02 Jul 2026", position:"SEC-ARC-04", classification:"Confidential" },
  { id:"EMP-1283", initials:"SD", name:"Seda Deniz", role:"Finance Analyst", department:"Finance", manager:"Ozan Polat", location:"Istanbul", status:"Active", start:"11 May 2025", position:"FIN-ANL-09", classification:"Confidential" },
  { id:"EMP-1304", initials:"OY", name:"Onur Yilmaz", role:"Platform Engineer", department:"Engineering", manager:"Aylin Kaya", location:"Remote / TR", status:"Preboarding", start:"05 Oct 2026", position:"ENG-PLT-22", classification:"Confidential" }
] as const;

export const positions = [
  { code:"ENG-DIR-01", title:"Engineering Director", org:"Engineering", incumbent:"Aylin Kaya", location:"Istanbul", grade:"D2", status:"Filled", critical:true },
  { code:"SEC-ARC-04", title:"Security Architect", org:"Security", incumbent:"Mehmet Bal", location:"Amsterdam", grade:"IC6", status:"Filled", critical:true },
  { code:"ENG-PLT-22", title:"Platform Engineer", org:"Engineering", incumbent:"Onur Yilmaz", location:"Remote / TR", grade:"IC4", status:"Filled", critical:false },
  { code:"SEC-GRC-08", title:"Senior GRC Specialist", org:"Security", incumbent:"—", location:"Istanbul", grade:"IC4", status:"Open", critical:false },
  { code:"PRD-DES-11", title:"Senior Product Designer", org:"Product", incumbent:"—", location:"Berlin", grade:"IC4", status:"Open", critical:false },
  { code:"FIN-MGR-02", title:"Finance Manager", org:"Finance", incumbent:"—", location:"Istanbul", grade:"M2", status:"Planned", critical:true }
] as const;

export const orgUnits = [
  { code:"ACME", name:"Acme Global", type:"Legal entity", head:"Mira Stone", people:512, positions:548 },
  { code:"TECH", name:"Technology", type:"Business unit", head:"Mert Demir", people:247, positions:269 },
  { code:"ENG", name:"Engineering", type:"Department", head:"Aylin Kaya", people:184, positions:198 },
  { code:"SEC", name:"Security", type:"Department", head:"Deniz Aksoy", people:29, positions:34 },
  { code:"PPL", name:"People", type:"Department", head:"Selin Arslan", people:35, positions:38 },
  { code:"FIN", name:"Finance", type:"Department", head:"Ozan Polat", people:48, positions:51 }
] as const;

export const documents = [
  { name:"Employment Agreement.pdf", owner:"Aylin Kaya", category:"Contract", classification:"Restricted", retention:"Employment + 10y", updated:"18 Sep 2026" },
  { name:"NDA v3.pdf", owner:"Can Yildiz", category:"Agreement", classification:"Restricted", retention:"Employment + 10y", updated:"14 Sep 2026" },
  { name:"Security Policy Acknowledgement", owner:"Mehmet Bal", category:"Policy evidence", classification:"Confidential", retention:"7 years", updated:"10 Sep 2026" },
  { name:"Right to Work.pdf", owner:"Onur Yilmaz", category:"Identity evidence", classification:"Restricted", retention:"Employment + 2y", updated:"08 Sep 2026" }
] as const;

export const auditEvents = [
  { actor:"Elif Karaca", action:"Viewed employee record", resource:"EMP-1042", purpose:"HRBP support", classification:"Confidential", time:"16:12" },
  { actor:"Selin Arslan", action:"Changed position assignment", resource:"EMP-1178", purpose:"Approved transfer", classification:"Confidential", time:"15:43" },
  { actor:"System", action:"Retention rule evaluated", resource:"DOC-8821", purpose:"Automated governance", classification:"Restricted", time:"15:30" },
  { actor:"Ozan Polat", action:"Viewed compensation band", resource:"POS-FIN-MGR-02", purpose:"Workforce planning", classification:"Restricted", time:"14:58" },
  { actor:"Privacy Office", action:"Export request opened", resource:"DSR-2026-018", purpose:"Data subject request", classification:"Restricted", time:"14:21" }
] as const;
