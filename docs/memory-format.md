# Memory Repo Formatı

ctx-lab kalıcı gerçeklik olarak GitHub'daki memory repo dosyalarını kullanır. SQLite veya tarayıcı cache yalnızca hızlandırma katmanıdır.

## Inbox session summary

```markdown
---
id: sess_20260513_ctx_lab_redesign_codex
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
branch: main
status: needs_triage
created_at: 2026-05-13T20:00:00+03:00
tags: [architecture, github-memory]
linked_work_item:
---

# Session Summary

## Goal
Bu oturumun hedefi.

## What Happened
- Yapılanlar.

## Decisions
- Alınan kararlar.

## Open Questions
- Açık sorular.

## Next Actions
- Sıradaki adımlar.

## Evidence
- Kaynak dosya, commit veya sohbet referansları.
```

Türkçe başlıklar da desteklenir: `Amaç`, `Yapılanlar`, `Kararlar`, `Açık Sorular`, `Sonraki Adımlar`, `Kanıtlar`.

## Work item

```markdown
---
id: work_ctx_lab_redesign
title: ctx-lab yeniden tasarım
project: ctx-lab
status: active
priority: high
updated_at: 2026-05-13T20:00:00+03:00
sessions:
  - sess_20260513_ctx_lab_redesign_codex
decisions:
  - dec_20260513_ai_inbox_github_sot
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
