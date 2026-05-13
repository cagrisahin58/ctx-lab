# Memory Repo Formatı

ctx-lab kalıcı gerçeklik olarak GitHub'daki memory repo dosyalarını kullanır. Tarayıcıdaki durum yalnızca çalışma zamanı görünümüdür.

## Klasörler

```text
inbox/       İşlenmemiş veya yeni bağlanacak oturum özetleri
work_items/  Aktif iş hatları
decisions/   Kaynaklı karar kayıtları
handoffs/    Codex/Claude devam prompt'ları
archive/     Tamamlanan veya kapatılan kayıtlar
config.yaml  Repo seviyesi kısa ayar dosyası
```

Geçerli kayıt tipleri: `inbox`, `work_items`, `decisions`, `handoffs`, `archive`.
Geçerli durumlar: `needs_triage`, `linked`, `active`, `waiting`, `blocked`, `done`, `archived`.
İş kartı panosunda yönetilen durumlar: `active`, `waiting`, `blocked`, `done`.

## Inbox session summary

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

# Session Summary

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

ctx-lab'ın `Yeni Özet` ekranı, Codex veya Claude sohbetinin sonuna yapıştırılacak standart bir prompt üretir. Beklenen çıktı yukarıdaki `Inbox session summary` şemasındaki markdown'dur. Kullanıcı bu çıktıyı `Hazır Markdown` alanına yapıştırdığında uygulama frontmatter'ı normalize eder:

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
status: active
priority: normal
updated_at: 2026-05-13T12:40:00.000Z
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

## Best Handoff Prompt
Codex veya Claude'a verilecek kısa devam prompt'u.
```

Yeni bir inbox kaydı aynı `work_<project>` id'sine denk gelirse ctx-lab yeni dosya açmak yerine mevcut iş kartının `sessions` listesini günceller.
Inbox triage ekranında kullanıcı farklı bir mevcut iş kartını seçerse aynı güncelleme seçilen kart için yapılır ve inbox kaydındaki `linked_work_item` bu iş kartının id'sine çekilir.
Inbox ekranı varsayılan olarak `needs_triage` kayıtlarını gösterir; `linked`, `archived` ve tüm kayıtlar UI filtresiyle görülebilir.
Pano üzerinden durum değiştirildiğinde yalnızca iş kartının frontmatter alanındaki `status` ve `updated_at` değerleri güncellenir; gövde korunur.

## Handoff / context pack

`handoffs/` altındaki kayıtlar artık yalnızca tek oturum özeti değildir. Seçili iş kartı için:

- iş kartındaki amaç, güncel durum, sonraki adım ve riskler,
- `sessions` listesindeki bağlı oturum özetleri,
- `decisions` listesi veya bağlı oturumlardan türeyen kararlar,
- Codex/Claude için çalışma kuralı

tek bir context pack içinde birleştirilir. Bu dosyalar temiz AI oturumlarında ilk prompt olarak kullanılmak üzere tasarlanır.
Karar ve handoff kayıtları aynı path ile tekrar kaydedilirse yeni kopya üretmek yerine mevcut dosya `sha` ile güncellenir.
