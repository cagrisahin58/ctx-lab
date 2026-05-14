# Hafıza Reposu Formatı

ctx-lab kalıcı gerçeklik olarak GitHub'daki hafıza reposu dosyalarını kullanır. Tarayıcıdaki durum yalnızca çalışma zamanı görünümüdür.

## Klasörler

```text
inbox/       İşlenmemiş veya yeni bağlanacak oturum özetleri
work_items/  Aktif iş hatları
decisions/   Kaynaklı karar kayıtları
handoffs/    Codex/Claude devam brifleri
archive/     Tamamlanan veya kapatılan kayıtlar
config.yaml  Repo seviyesi kısa ayar dosyası
```

Repo tanılaması bu klasörleri, `config.yaml` dosyasını, seçili branch'i ve repo erişimini kontrol eder.

## Yerel önbellek

ctx-lab, son başarılı GitHub senkronizasyonundan gelen kayıt anlık görüntüsünü tarayıcı localStorage alanında saklar. Önbellek `owner/repo@branch` kapsamıyla ayrılır; farklı hafıza reposu veya branch seçildiğinde eski kayıtlar yeni ekranda gösterilmez. Bu önbellek yalnızca hızlı açılış ve geçici çevrimdışı görünürlük içindir. Kalıcı kaynak gerçeklik GitHub hafıza reposudur. Son görülen branch HEAD değeri de önbellek metadata içinde tutulur; yazma öncesinde HEAD değişmişse kullanıcıya repo dışarıdan güncellendi uyarısı gösterilir ve yenileme istenir.

Geçerli kayıt tipleri: `inbox`, `work_items`, `decisions`, `handoffs`, `archive`.
Geçerli durumlar: `needs_triage`, `linked`, `active`, `waiting`, `blocked`, `done`, `archived`.
İş kartı panosunda yönetilen durumlar: `active`, `waiting`, `blocked`, `done`.

## Zaman akışı event katmanı

v2 arayüzü mevcut markdown/frontmatter formatını bozmadan kayıtlardan türetilmiş bir zaman akışı katmanı oluşturur. Bu katman kalıcı şemayı değiştirmez; `inbox` oturumları, `work_items` iş hattı güncellemeleri, `decisions` kararlar, `handoffs` devam brifleri, `archive` kayıtları, yerel proje kökleri ve Codex çalıştırma günlükleri tek sıralı olay listesine dönüştürülür. Eski kayıtlar zaman akışı içinde görünmeye devam eder.

Yerel masaüstü aynası bu kayıtları `%APPDATA%/ctx-lab/memory/git` altında Git clone olarak, özet indeksi de `%APPDATA%/ctx-lab/memory/index/<owner>__<repo>__<branch>.json` altında tutar. İndeks türetilmiş veridir; GitHub hafıza reposu kaynak gerçeklik olmaya devam eder.

## Oturum özeti

Dosya yolu örneği:

```text
inbox/2026-05-13T12-34-56-789Z-ctx-lab-codex.md
```

```markdown
---
id: sess_2026-05-13T12-34-56-789Z_ctx-lab_codex
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: needs_triage
created_at: 2026-05-13T12:34:56.789Z
tags:
  - architecture
  - github-memory
linked_work_item:
---

# Oturum Özeti

## Amaç
Bu oturumun hedefi.

## Yapılanlar
- Yapılanlar.

## Kararlar
- Alınan kararlar.

## Açık Sorular
- Açık sorular.

## Sonraki Adımlar
- Sıradaki adımlar.

## Kanıtlar
- Kaynak dosya, commit veya sohbet referansları.
```

İngilizce başlıklar da okunur: `Goal`, `What Happened`, `Decisions`, `Open Questions`, `Next Actions`, `Evidence`.

## Oturum kapanış prompt'u

ctx-lab'ın `Yeni Oturum Özeti` ekranı, Codex veya Claude sohbetinin sonuna yapıştırılacak standart bir prompt üretir. Beklenen çıktı yukarıdaki oturum özeti şemasındaki markdown'dur. Kullanıcı bu çıktıyı `Hazır Markdown` alanına yapıştırdığında uygulama frontmatter'ı normalize eder:

- `status` her zaman `needs_triage` yapılır,
- `id` yoksa timestamp, proje ve kaynak bilgisinden üretilir,
- `created_at` yoksa kayıt anı kullanılır,
- `linked_work_item` boş bırakılır.

## Work item

```markdown
---
id: work_ctx-lab
title: ctx-lab çalışma hattı
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: active
priority: normal
updated_at: 2026-05-13T12:40:00.000Z
tags:
  - tasarim
sessions:
  - sess_2026-05-13T12-34-56-789Z_ctx-lab_codex
decisions:
---

## Objective
İşin amacı.

## Current State
Güncel durum.

## Next Action
Bir sonraki en iyi adım.

## Risks / Blockers
Riskler ve engeller.

## Devam Brifi
Codex veya Claude'a verilecek kısa devam prompt'u.
```

Yeni bir oturum kaydı aynı `work_<project>` id'sine denk gelirse ctx-lab yeni dosya açmak yerine mevcut iş kartının `sessions` listesini günceller.
`Yeni İş Hattı` ekranından açılan manuel iş kartları da aynı `work_items/` formatını kullanır; başlangıçta `sessions` ve `decisions` listeleri boştur.
Oturum Akışı ekranında kullanıcı farklı bir mevcut iş kartını seçerse aynı güncelleme seçilen kart için yapılır ve oturum kaydındaki `linked_work_item` bu iş kartının id'sine çekilir.
Oturum Akışı, `project`, `repo`, ortak `tags` ve son güncellenme tarihine göre mevcut iş hattı önerisi gösterebilir. Kullanıcı öneriyi reddederse inbox frontmatter alanına `triage_suggestion_dismissed` listesi yazılır ve aynı iş hattı tekrar önerilmez.
Oturum Akışı varsayılan olarak `needs_triage` kayıtlarını gösterir; `linked`, `archived` ve tüm kayıtlar UI filtresiyle görülebilir.
Pano üzerinden durum değiştirildiğinde yalnızca iş kartının frontmatter alanındaki `status` ve `updated_at` değerleri güncellenir; gövde korunur.
Pano üzerinden `Next Action` bölümü güncellendiğinde ilgili markdown section değiştirilir ve `updated_at` yenilenir.
Oturum kaydından karar çıkarıldığında ilgili iş kartı bulunabiliyorsa karar id'si iş kartının `decisions` listesine otomatik eklenir.
Oturum kaydı arşive taşındığında archive dosyasına `status: archived` ve `archived_at` yazılır; ardından kaynak inbox dosyası silinir.
Tamamlanan (`status: done`) iş hatları da aynı güvenli iki adımlı onayla `archive/` altına taşınabilir. Aktif, bekleyen veya engelli iş hatları arşivlenmez; önce durumun `done` yapılması gerekir.

## Decision record

Manuel karar kayıtları `Karar Defteri > Yeni Karar` akışıyla oluşturulur. Bir iş hattı seçilirse `source_work_item` alanı doldurulur ve karar id'si ilgili iş kartının `decisions` listesine eklenir.

```markdown
---
id: dec_2026-05-13T12-00-00-000Z_memory-repo-kaynak-olacak
title: Hafıza reposu kaynak olacak
project: ctx-lab
source: manual
source_work_item: work_ctx-lab
created_at: 2026-05-13T12:00:00.000Z
tags:
  - github-memory
---

## Karar
GitHub hafıza reposu kalıcı kaynak olarak kullanılacak.

## Gerekçe
Claude ve Codex arasında taşınabilirlik gerekiyor.

## Etki
Devam brifi ve günlük brif kayıtları repodan okunacak.

## Kaynak
Plan oturumu.
```

## Devam brifi

`handoffs/` altındaki kayıtlar artık yalnızca tek oturum özeti değildir. Seçili iş kartı için:

- iş kartındaki amaç, güncel durum, sonraki adım ve riskler,
- `sessions` listesindeki bağlı oturum özetleri,
- `decisions` listesi veya bağlı oturumlardan türeyen kararlar,
- Codex/Claude için çalışma kuralı

tek bir devam brifi içinde birleştirilir. Bu dosyalar temiz AI oturumlarında ilk prompt olarak kullanılmak üzere tasarlanır.
`Devam Brifi` ekranında kaynak kayıt ve hedef araç seçildiğinde önizleme aynı seçimle güncellenir; kaydedilen dosyada `target` alanı `codex` veya `claude` olarak tutulur.
Karar ve devam brifi kayıtları aynı path ile tekrar kaydedilirse yeni kopya üretmek yerine mevcut dosya `sha` ile güncellenir.
GitHub 409/422 yazma hatalarında dosyanın güncel `sha` değeri okunur ve yazma bir kez yeniden denenir.

`Günlük Devam Brifi` kaydedildiğinde `handoffs/daily-YYYY-MM-DD.md` yolu kullanılır ve aynı gün yeniden kaydedilirse dosya güncellenir.

## Codex çalıştırma kaydı

Yerel Codex otomasyonu çalıştırıldığında sonuç `%APPDATA%/ctx-lab/runs` altında JSON günlük olarak kalır. Kullanıcı çalıştırma sonucunu hafıza reposuna bağlamayı seçerse ctx-lab ayrıca `handoffs/` altında `kind: codex_run` frontmatter alanına sahip bir kayıt üretir. Seçili iş hattı varsa bu iş hattının frontmatter alanına `codex_runs` listesi eklenir. Böylece çalıştırma geçmişi hem yerel günlükte hem de GitHub work-memory zaman akışı içinde izlenebilir.
