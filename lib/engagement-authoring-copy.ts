import type { Locale } from "@/lib/i18n";

/** Fixed UI/error copy only; customer-authored survey text is never translated. */
const turkish: Record<string, string> = {
  "Survey authoring": "Anket hazırlama", "Close authoring": "Anket hazırlamayı kapat",
  "Survey code": "Anket kodu", "Survey name": "Anket adı", "Description": "Açıklama",
  "Create survey": "Anket oluştur", "Survey": "Anket", "Select survey…": "Anket seçin…",
  "No description": "Açıklama yok", "campaign(s)": "kampanya", "Edit survey": "Anketi düzenle",
  "Delete survey": "Anketi sil", "Survey locked": "Anket kilitli", "Code": "Kod", "Name": "Ad",
  "Save survey": "Anketi kaydet", "Cancel": "İptal", "Key": "Anahtar", "Prompt": "Soru metni",
  "Type": "Tür", "Dimension": "Boyut", "Required": "Zorunlu", "Actions": "İşlemler",
  "Yes": "Evet", "No": "Hayır", "Up": "Yukarı", "Down": "Aşağı", "Edit": "Düzenle",
  "Delete": "Sil", "Locked": "Kilitli", "No questions authored yet.": "Henüz soru eklenmedi.",
  "Question key": "Soru anahtarı", "Scale": "Ölçek", "Single choice": "Tek seçim",
  "Multi choice": "Çoklu seçim", "Text": "Metin", "eNPS": "eNPS",
  "Options (comma separated)": "Seçenekler (virgülle ayrılmış)", "Save question": "Soruyu kaydet",
  "Add question": "Soru ekle", "Cancel edit": "Düzenlemeyi iptal et",
  "SCALE": "Ölçek", "SINGLE_CHOICE": "Tek seçim", "MULTI_CHOICE": "Çoklu seçim", "TEXT": "Metin", "ENPS": "eNPS",
  "Authoring is locked because a campaign using this survey has left DRAFT, or you are not the survey creator.": "Bu anketi kullanan bir kampanya taslak durumundan çıktığı veya anketi siz oluşturmadığınız için düzenleme kilitli.",
  "Survey code and name are required.": "Anket kodu ve adı zorunludur.",
  "Question key and prompt are required.": "Soru anahtarı ve soru metni zorunludur.",
  "Delete this survey question?": "Bu anket sorusunu silmek istediğinize emin misiniz?",
  "Delete this unused survey and its questions?": "Bu kullanılmayan anketi ve sorularını silmek istediğinize emin misiniz?",
  "Survey could not be created.": "Anket oluşturulamadı.", "Survey could not be updated.": "Anket güncellenemedi.",
  "Survey could not be deleted.": "Anket silinemedi.", "Question could not be saved.": "Soru kaydedilemedi.",
  "Question could not be deleted.": "Soru silinemedi.", "Question order could not be updated.": "Soru sırası güncellenemedi.",
  "The result could not be confirmed. Reload current records before trying another change.": "İşlemin sonucu doğrulanamadı. Başka bir değişiklik yapmadan önce güncel kayıtları yeniden yükleyin.",
  "Reload current records": "Güncel kayıtları yeniden yükle",
  "Sign in again before continuing.": "Devam etmeden önce yeniden giriş yapın.",
  "Your current permissions do not allow this action.": "Mevcut yetkileriniz bu işleme izin vermiyor.",
  "The record is no longer available. Reload current records.": "Kayıt artık kullanılamıyor. Güncel kayıtları yeniden yükleyin.",
  "The record already exists, has changed or is in use. Reload and check it before retrying.": "Kayıt zaten mevcut, değiştirilmiş veya kullanımda. Yeniden denemeden önce güncel kayıtları yükleyip kontrol edin.",
  "Check the required fields and allowed values.": "Zorunlu alanları ve izin verilen değerleri kontrol edin.",
  "Too many requests. Wait before trying again.": "Çok fazla istek gönderildi. Yeniden denemeden önce bekleyin.",
  "New campaign": "Yeni kampanya", "Close campaign form": "Kampanya formunu kapat",
  "Select authored survey…": "Hazırlanmış anketi seçin…",
  "Create a survey with at least one question before creating a campaign.": "Kampanya oluşturmadan önce en az bir sorusu olan bir anket hazırlayın.",
  "Campaign name": "Kampanya adı", "Anonymity threshold": "Anonimlik eşiği",
  "Opens at": "Açılış zamanı", "Closes at": "Kapanış zamanı", "Anonymous campaign": "Anonim kampanya",
  "Audience": "Hedef kitle", "Relationship scoped": "İlişki kapsamıyla sınırlı", "Tenant authorized": "Kuruluş yetki kapsamında",
  "blank = full authorized scope": "seçim yapılmazsa tüm yetkili kapsam", "Scope not loaded": "Kapsam yüklenmedi",
  "Loading audience options…": "Hedef kitle seçenekleri yükleniyor…", "Organization units": "Organizasyon birimleri",
  "Positions": "Pozisyonlar", "Create draft campaign": "Taslak kampanya oluştur",
  "Survey and campaign name are required.": "Anket ve kampanya adı zorunludur.",
  "Campaign could not be created.": "Kampanya oluşturulamadı.",
  "Audience options could not be loaded. Retry explicitly to continue.": "Hedef kitle seçenekleri yüklenemedi. Devam etmek için yeniden yüklemeyi deneyin.",
  "Retry audience loading": "Hedef kitleyi yeniden yükle",
  "Anonymity threshold must be an integer between 5 and 1000.": "Anonimlik eşiği 5 ile 1000 arasında bir tam sayı olmalıdır.",
  "The campaign closing time must be after its opening time.": "Kampanya kapanış zamanı açılış zamanından sonra olmalıdır.",
  "Enter valid campaign dates.": "Geçerli kampanya tarihleri girin.",
  "A survey with this code already exists.": "Bu kodla bir anket zaten mevcut.",
  "Only the survey creator may edit it.": "Anketi yalnızca oluşturan kişi düzenleyebilir.",
  "Only the survey creator may delete it.": "Anketi yalnızca oluşturan kişi silebilir.",
  "Surveys referenced by campaigns cannot be deleted.": "Kampanyaların kullandığı anketler silinemez.",
  "Survey metadata is locked after a campaign leaves DRAFT.": "Bir kampanya taslak durumundan çıktıktan sonra anket bilgileri kilitlenir.",
  "code may contain letters, numbers, underscore and dash only.": "Kod yalnızca harf, rakam, alt çizgi ve tire içerebilir."
};

export function authoringText(locale: Locale, text: string): string {
  return locale === "tr" && Object.hasOwn(turkish, text) ? turkish[text] : text;
}

/** Return fixed known copy, never untrusted server text or internal diagnostics. */
export function authoringError(status: number, fallback: string, serverMessage?: unknown): string {
  if (typeof serverMessage === "string" && Object.hasOwn(turkish, serverMessage)) return serverMessage;
  if (status === 401) return "Sign in again before continuing.";
  if (status === 403) return "Your current permissions do not allow this action.";
  if (status === 404) return "The record is no longer available. Reload current records.";
  if (status === 409) return "The record already exists, has changed or is in use. Reload and check it before retrying.";
  if (status === 400 || status === 422) return "Check the required fields and allowed values.";
  if (status === 429) return "Too many requests. Wait before trying again.";
  return fallback;
}
