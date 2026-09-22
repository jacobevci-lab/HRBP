import { BadgeCheck, CloudCog, FileLock2, Fingerprint, HardDrive, KeyRound, Link2, LockKeyhole, MoreHorizontal, ScanSearch, ShieldCheck, Signature } from "lucide-react";
import { AccessScopeAdmin } from "@/components/access-scope-admin";
import { JurisdictionAdmin } from "@/components/jurisdiction-admin";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";

export const platformAdminWorkspaceSlugs = new Set(["documents", "settings"]);

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function Metric({icon,label,value,meta}:{icon:React.ReactNode;label:string;value:string;meta:string}) {
  return <div className="platform-metric card"><div className="platform-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({value,label}:{value:string;label?:string}) {
  return <em className={`platform-pill ${value.toLowerCase().replace(/\s+/g,"-")}`}>{label ?? value}</em>;
}

function status(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const labels: Record<string,string> = {
    Signed:"İmzalandı", Final:"Nihai", "Awaiting signature":"İmza bekliyor", Restricted:"Kısıtlı",
    Active:"Aktif", Review:"İncelemede", Healthy:"Sağlıklı", Paused:"Duraklatıldı"
  };
  return labels[value] ?? value;
}

function Documents({ locale }:{ locale: Locale }) {
  const rows = [
    [c(locale,"Employment Agreement - E00482","İş Sözleşmesi - E00482"), c(locale,"Employee record","Çalışan kaydı"), "v3", c(locale,"Restricted","Kısıtlı"), c(locale,"Clean","Temiz"), "Signed"],
    [c(locale,"Performance Review - 2026","Performans Değerlendirmesi - 2026"), c(locale,"Performance","Performans"), "v1", c(locale,"Confidential","Gizli"), c(locale,"Clean","Temiz"), "Final"],
    [c(locale,"Remote Work Addendum","Uzaktan Çalışma Eki"), c(locale,"Policy / contract","Politika / sözleşme"), "v2", c(locale,"Restricted","Kısıtlı"), c(locale,"Clean","Temiz"), "Awaiting signature"],
    [c(locale,"Medical accommodation","Sağlık uyarlaması"), c(locale,"Case-linked","Vakaya bağlı"), "v1", c(locale,"Highly restricted","Yüksek kısıtlı"), c(locale,"Case wall","Vaka duvarı"), "Restricted"]
  ];
  return <>
    <section className="platform-metrics">
      <Metric icon={<HardDrive size={18}/>} label={c(locale,"Vault objects","Kasa nesneleri")} value="18,942" meta={c(locale,"All HR document versions","Tüm İK doküman versiyonları")}/>
      <Metric icon={<ScanSearch size={18}/>} label={c(locale,"Malware scan","Zararlı yazılım taraması")} value="100%" meta={c(locale,"No unscanned active version","Taranmamış aktif sürüm yok")}/>
      <Metric icon={<Signature size={18}/>} label={c(locale,"Signature envelopes","İmza zarfları")} value="23" meta={c(locale,"7 awaiting employee action","7 çalışan aksiyonu bekliyor")}/>
      <Metric icon={<FileLock2 size={18}/>} label="Legal hold" value="31" meta={c(locale,"Retention deletion suspended","Saklama silme işlemi askıda")}/>
    </section>
    <section className="platform-split">
      <div className="card platform-panel"><div className="platform-head"><div><span className="section-kicker">{c(locale,"Private document vault","Özel doküman kasası")}</span><h3>{c(locale,"Versioned HR records","Versiyonlu İK kayıtları")}</h3></div><MoreHorizontal size={18}/></div><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>{c(locale,"Document","Doküman")}</th><th>{c(locale,"Purpose","Amaç")}</th><th>{c(locale,"Version","Sürüm")}</th><th>{c(locale,"Classification","Sınıflandırma")}</th><th>{c(locale,"Security","Güvenlik")}</th><th>{c(locale,"State","Durum")}</th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]} label={status(locale,r[5])}/></td></tr>)}</tbody></table></div></div>
      <aside className="card platform-side"><div className="platform-head"><div><span className="section-kicker">{c(locale,"Vault controls","Kasa kontrolleri")}</span><h3>{c(locale,"Record integrity","Kayıt bütünlüğü")}</h3></div><ShieldCheck size={18}/></div><div className="platform-controls"><p><Fingerprint size={17}/><span><strong>{c(locale,"Immutable version hash","Değiştirilemez sürüm hash'i")}</strong><small>{c(locale,"Every version keeps its own content hash and object key.","Her sürüm kendi içerik hash'ini ve nesne anahtarını korur.")}</small></span></p><p><ScanSearch size={17}/><span><strong>{c(locale,"Quarantine before use","Kullanmadan önce karantina")}</strong><small>{c(locale,"New content stays pending until malware scanning is clean.","Yeni içerik zararlı yazılım taraması temiz sonuçlanana kadar bekler.")}</small></span></p><p><Signature size={17}/><span><strong>{c(locale,"Built-in signature trail","Yerleşik imza izi")}</strong><small>{c(locale,"Envelope, signer state, event timestamps and IP evidence remain in platform.","Zarf, imzalayan durumu, olay zaman damgaları ve IP kanıtı platformda kalır.")}</small></span></p><p><LockKeyhole size={17}/><span><strong>{c(locale,"Case-wall separation","Vaka duvarı ayrımı")}</strong><small>{c(locale,"Highly restricted case files do not appear in the general vault listing.","Yüksek kısıtlı vaka dosyaları genel kasa listesinde görünmez.")}</small></span></p></div></aside>
    </section>
  </>;
}

function Settings({ locale }:{ locale: Locale }) {
  const idpRows = [
    ["Corporate Entra ID", "Entra ID", "SSO + SCIM", c(locale,"MFA required","MFA zorunlu"), c(locale,"2m ago","2 dk önce"), "Active"],
    [c(locale,"Break-glass local","Break-glass yerel"), c(locale,"Local","Yerel"), c(locale,"Emergency only","Yalnızca acil durum"), "Hardware MFA", c(locale,"14d ago","14 gün önce"), "Active"],
    ["AcquiredCo Okta", "Okta", "SSO", c(locale,"MFA required","MFA zorunlu"), c(locale,"1h ago","1 sa önce"), "Review"]
  ];
  const integrationRows = [
    ["Microsoft 365", c(locale,"Directory / collaboration","Dizin / iş birliği"), "OAuth ref", "15m", "Healthy"],
    ["Finance ERP", "Payroll GL", "Vault ref", "1h", "Healthy"],
    [c(locale,"Learning provider","Eğitim sağlayıcısı"), c(locale,"Course catalog","Kurs kataloğu"), "OAuth ref", "6h", "Healthy"],
    [c(locale,"Background check","Geçmiş kontrolü"), c(locale,"Recruiting","İşe Alım"), "Vault ref", "24h", "Paused"]
  ];
  return <>
    <section className="platform-metrics">
      <Metric icon={<KeyRound size={18}/>} label={c(locale,"Identity providers","Kimlik sağlayıcıları")} value="3" meta={c(locale,"2 federated · 1 break-glass","2 federasyon · 1 break-glass")}/>
      <Metric icon={<Link2 size={18}/>} label={c(locale,"Integrations","Entegrasyonlar")} value="14" meta={c(locale,"12 healthy · 2 attention","12 sağlıklı · 2 dikkat")}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c(locale,"MFA enforcement","MFA zorunluluğu")} value="100%" meta={c(locale,"Privileged and workforce access","Ayrıcalıklı ve çalışan erişimi")}/>
      <Metric icon={<CloudCog size={18}/>} label={c(locale,"Data region","Veri bölgesi")} value="EU" meta={c(locale,"Tenant residency policy","Tenant veri yerleşimi politikası")}/>
    </section>
    <AccessScopeAdmin/>
    <JurisdictionAdmin/>
    <section className="settings-grid">
      <div className="card platform-panel"><div className="platform-head"><div><span className="section-kicker">{c(locale,"Identity & provisioning","Kimlik & provisioning")}</span><h3>{c(locale,"Authentication connections","Kimlik doğrulama bağlantıları")}</h3></div><BadgeCheck size={18}/></div><div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>{c(locale,"Name","Ad")}</th><th>{c(locale,"Type","Tür")}</th><th>Provisioning</th><th>{c(locale,"Control","Kontrol")}</th><th>{c(locale,"Validated","Doğrulandı")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{idpRows.map(r=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]} label={status(locale,r[5])}/></td></tr>)}</tbody></table></div></div>
      <div className="card platform-panel"><div className="platform-head"><div><span className="section-kicker">{c(locale,"Connected systems","Bağlı sistemler")}</span><h3>{c(locale,"Integration registry","Entegrasyon kaydı")}</h3></div><Link2 size={18}/></div><div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>{c(locale,"Connection","Bağlantı")}</th><th>{c(locale,"Purpose","Amaç")}</th><th>{c(locale,"Credential","Kimlik bilgisi")}</th><th>{c(locale,"Sync","Senkronizasyon")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{integrationRows.map(r=><tr key={r[0]}>{r.slice(0,4).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[4]} label={status(locale,r[4])}/></td></tr>)}</tbody></table></div></div>
      <aside className="card platform-side security-posture"><div className="platform-head"><div><span className="section-kicker">{c(locale,"Tenant security","Tenant güvenliği")}</span><h3>{c(locale,"Default posture","Varsayılan duruş")}</h3></div><ShieldCheck size={18}/></div><div className="security-list"><div><span>MFA</span><strong>{c(locale,"Required","Zorunlu")}</strong></div><div><span>{c(locale,"Restricted export","Kısıtlı dışa aktarma")}</span><strong>{c(locale,"Blocked","Engelli")}</strong></div><div><span>{c(locale,"Watermarking","Filigran")}</span><strong>{c(locale,"Enabled","Etkin")}</strong></div><div><span>Break glass</span><strong>{c(locale,"Enabled","Etkin")}</strong></div><div><span>{c(locale,"Secrets","Sırlar")}</span><strong>{c(locale,"References only","Yalnızca referans")}</strong></div></div></aside>
    </section>
  </>;
}

export async function PlatformAdminWorkspace({slug}:{slug:string}) {
  const locale = await getServerLocale();
  return <div className="platform-shell">{slug === "documents" ? <Documents locale={locale}/> : <Settings locale={locale}/>}</div>;
}
