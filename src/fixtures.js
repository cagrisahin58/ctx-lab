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

# Session Summary

## Amaç
ctx-lab projesini GitHub-backed AI Work Memory sistemine dönüştürme yönünü netleştirmek.

## Yapılanlar
- Eski prototip mimarisinin hook-heavy ve kırılgan olduğu değerlendirildi.
- Memory repo source-of-truth yaklaşımı benimsendi.
- AI Inbox, İş Panosu, Karar Defteri ve Handoff ekranları ana yapı olarak seçildi.

## Kararlar
- V1 tamamen Türkçe olacak.
- Hook entegrasyonları v2'ye bırakılacak.
- GitHub memory repo tek zorunlu entegrasyon olacak.

## Açık Sorular
- Memory repo adı ve private repo konumu netleşecek.

## Sonraki Adımlar
- Yeni uygulama iskeletini kur.
- Memory markdown parser ve AI Inbox ekranını çalışır hale getir.

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
AI sohbetleri kaybolsa bile insan çalışma bağlamını koruyan GitHub-backed uygulamayı geliştirmek.

## Current State
Ürün yönü seçildi; uygulama sıfırdan kuruluyor.

## Next Action
AI Inbox ve GitHub repo bağlantısını işlevsel hale getir.

## Risks / Blockers
GitHub token deneyimi sade olmalı.
`
  },
  {
    path: "decisions/dec_20260513_github_sot.md",
    content: `---
id: dec_20260513_github_sot
title: GitHub memory repo source-of-truth olacak
project: ctx-lab
source_session: sess_20260513_ctx_lab_redesign_codex
created_at: ${now}
---

## Karar
Kalıcı çalışma hafızası için GitHub memory repo ana gerçeklik olacak. Uygulama cache tutabilir ama kalıcı veri repo dosyalarından okunacak.

## Kaynak
- inbox/2026-05-13-ctx-lab-redesign-codex.md
`
  }
];

export function demoRecords() {
  return samples.map((sample, index) => parseMemoryFile(sample.path, sample.content, `demo-${index}`));
}
