import { parseMemoryFile } from "./domain.js";

const now = new Date().toISOString();

const samples = [
  {
    path: "inbox/2026-05-13-ctx-lab-redesign-codex.md",
    content: `---
id: sess_20260513_ctx_lab_redesign_codex
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: needs_triage
created_at: ${now}
tags: [architecture, github-memory]
linked_work_item:
---

# Oturum Özeti

## Amaç
ctx-lab projesini GitHub destekli AI çalışma hafızası sistemine dönüştürme yönünü netleştirmek.

## Yapılanlar
- Eski prototip mimarisinin hook ağırlıklı ve kırılgan olduğu değerlendirildi.
- Hafıza reposunu kaynak gerçeklik kabul eden yaklaşım benimsendi.
- Oturum Akışı, İş Akışı, Karar Defteri ve Devam Brifi ekranları ana yapı olarak seçildi.

## Kararlar
- V1 tamamen Türkçe olacak.
- Hook entegrasyonları v2'ye bırakılacak.
- GitHub hafıza reposu tek zorunlu entegrasyon olacak.

## Açık Sorular
- Hafıza reposu adı ve özel repo konumu netleşecek.

## Sonraki Adımlar
- Yeni uygulama iskeletini kur.
- Hafıza markdown ayrıştırıcısı ve Oturum Akışı ekranını çalışır hale getir.

## Kanıtlar
- cagrisahin58/ctx-lab main branch
`
  },
  {
    path: "work_items/work_ctx_lab_redesign.md",
    content: `---
id: work_ctx_lab_redesign
title: ctx-lab yeniden tasarım
project: ctx-lab
status: active
priority: high
updated_at: ${now}
sessions:
  - sess_20260513_ctx_lab_redesign_codex
decisions: []
---

## Objective
AI sohbetleri kaybolsa bile insan çalışma bağlamını koruyan GitHub destekli uygulamayı geliştirmek.

## Current State
Ürün yönü seçildi; uygulama sıfırdan kuruluyor.

## Next Action
Oturum Akışı ve hafıza bağlantısını işlevsel hale getir.

## Risks / Blockers
GitHub token deneyimi sade olmalı.
`
  },
  {
    path: "inbox/2026-05-13-ctx-lab-runner-codex.md",
    content: `---
id: sess_20260513_ctx_lab_runner_codex
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: needs_triage
created_at: ${now}
tags: [desktop, codex-runner]
linked_work_item:
---

# Oturum Özeti

## Amaç
Masaüstü kabukta Codex CLI çalıştırma akışının kullanıcıya nasıl gösterileceğini netleştirmek.

## Yapılanlar
- Yerel proje kökü izni, çalışma günlüğü ve Codex run kaydı aynı akışta ele alındı.
- Commit öncesi test sonucu ve değişiklik özeti görünür olmalı kararı alındı.
- GitHub hafızası ile yerel ayna durumunun ayrı etiketlerle gösterilmesi gerektiği belirlendi.

## Kararlar
- Codex çalıştırmaları yalnızca kayıtlı proje köklerinde başlatılacak.
- İlk otomasyon seviyesi brif hazırlama ve öneri üretme ile sınırlı kalacak.

## Sonraki Adımlar
- Codex run ilerlemesini timeline olayına bağla.
- Başarısız çalıştırma loglarını Devam Brifi panelinden erişilebilir yap.

## Kanıtlar
- scripts/ctxlab-runner.mjs
`
  },
  {
    path: "decisions/dec_20260513_github_sot.md",
    content: `---
id: dec_20260513_github_sot
title: GitHub hafıza reposu kaynak gerçeklik olacak
project: ctx-lab
source_session: sess_20260513_ctx_lab_redesign_codex
created_at: ${now}
---

## Karar
Kalıcı çalışma hafızası için GitHub hafıza reposu ana gerçeklik olacak. Uygulama önbellek tutabilir ama kalıcı veri repo dosyalarından okunacak.

## Kaynak
- inbox/2026-05-13-ctx-lab-redesign-codex.md
`
  },
  {
    path: "decisions/dec_20260513_side_project.md",
    content: `---
id: dec_20260513_side_project
title: Yan proje keşif kararı
project: yan-proje
created_at: ${now}
---

## Karar
Yan proje kayıtları demo ortamında proje kapsam filtresinin davranışını göstermek için ayrı tutulacak.

## Kaynak
- demo/yan-proje
`
  }
];

export function demoRecords() {
  return samples.map((sample, index) => parseMemoryFile(sample.path, sample.content, `demo-${index}`));
}
