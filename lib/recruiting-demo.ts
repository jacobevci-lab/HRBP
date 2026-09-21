export const requisitions = [
  { id:"REQ-2618", title:"Senior GRC Specialist", org:"Security", location:"Istanbul", manager:"Deniz Aksoy", recruiter:"Ece Acar", candidates:18, status:"Open", target:"30 Sep" },
  { id:"REQ-2622", title:"Senior Product Designer", org:"Product", location:"Berlin", manager:"Can Yildiz", recruiter:"Mina Wolf", candidates:26, status:"Open", target:"12 Oct" },
  { id:"REQ-2627", title:"Finance Manager", org:"Finance", location:"Istanbul", manager:"Ozan Polat", recruiter:"Ece Acar", candidates:9, status:"Approval", target:"25 Oct" },
  { id:"REQ-2631", title:"Cloud Platform Engineer", org:"Engineering", location:"Remote / EU", manager:"Aylin Kaya", recruiter:"Mina Wolf", candidates:33, status:"Open", target:"18 Oct" }
] as const;

export const pipeline = [
  { stage:"Applied", count:24, people:["Lena Hoffmann","Bora Aksoy","Mila Vermeer"] },
  { stage:"Screening", count:17, people:["Kerem Cetin","Nora Klein","Efe Kaya"] },
  { stage:"Interview", count:12, people:["Sara Demir","Jonas Wolf","Derya Arslan"] },
  { stage:"Assessment", count:5, people:["Emre Polat","Julia Beck"] },
  { stage:"Offer", count:6, people:["Onur Yilmaz","Elena Costa"] }
] as const;

export const onboardingPeople = [
  { initials:"OY", name:"Onur Yilmaz", role:"Platform Engineer", start:"05 Oct", progress:72, owner:"Elif Karaca", blockers:0 },
  { initials:"SK", name:"Selin Kurt", role:"GRC Specialist", start:"12 Oct", progress:46, owner:"Elif Karaca", blockers:1 },
  { initials:"JB", name:"Jonas Berg", role:"Product Designer", start:"19 Oct", progress:31, owner:"Mina Wolf", blockers:0 },
  { initials:"NA", name:"Nehir Aydin", role:"Finance Analyst", start:"02 Nov", progress:18, owner:"Ece Acar", blockers:2 }
] as const;

export const onboardingTasks = [
  { task:"Employment documents", owner:"HR Operations", due:"T-10", completion:"92%", risk:"Healthy" },
  { task:"Identity & baseline access", owner:"IT / IAM", due:"T-5", completion:"78%", risk:"Healthy" },
  { task:"Equipment preparation", owner:"IT", due:"T-3", completion:"83%", risk:"Healthy" },
  { task:"Policies & mandatory learning", owner:"People", due:"T+3", completion:"61%", risk:"Watch" },
  { task:"Manager first-week plan", owner:"Manager", due:"T-2", completion:"68%", risk:"Watch" }
] as const;
