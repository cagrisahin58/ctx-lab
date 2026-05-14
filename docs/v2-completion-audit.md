# ctx-lab v2 tamamlama denetimi

Bu belge, masaustu odakli ctx-lab v2 hedefini gercek repo artefaktlari ve calisan test kanitlariyla takip eder. Amac "bitti" demek degil; hangi gereksinimin hangi dosya, test veya CI sonucu ile kapandigini ve hangi noktalarda kanitin zayif kaldigini gorunur tutmaktir.

Son denetim tarihi: 2026-05-14
Son denetlenen uygulama commit'i: `6ed9b24` (`Add optional GitHub live diagnostics`)
GitHub Actions: `Verify` run `25863917996`, `verify` ve `desktop-verify` basarili; `desktop-verify` screenshot artefakti uretti.
Not: Bu belge yalnizca audit kanitini guncelleyen sonraki dokumantasyon commit'lerinden etkilenmemek icin "uygulama commit'i" terimini kullanir.

## Kalite kapisi kanitlari

| Kapi | Son yerel kanit | CI kaniti | Durum |
| --- | --- | --- | --- |
| `npm test` | `npm run verify` icinde 111 test basarili | `verify` job basarili | Kapali |
| `npm run build` | `npm run verify` ve `npm run verify:desktop` icinde basarili | `verify` ve `desktop-verify` job'lari basarili | Kapali |
| `npm run smoke` | `npm run verify` icinde `dist smoke ok` | `verify` job basarili | Kapali |
| `npm run verify` | Basarili | `verify` job basarili | Kapali |
| `npm run verify:desktop` | `desktop:smoke` ve `desktop:flow` basarili | `desktop-verify` job basarili | Kapali |
| Windows launcher | `scripts/start-windows.ps1 -DryRun -SkipInstall` basarili, `codex.cmd` bulundu | `desktop-verify` icinde dry-run basarili | Kapali |
| Paket smoke | Onceki denetimde `npm run desktop:pack:smoke` basarili; CI her push'ta calistiriyor | `desktop-verify` icinde basarili | Kapali |

Not: `desktop:pack:smoke`, Windows exe politikasi nedeniyle `app.asar` fallback kullandigini bildirebilir; bu durum smoke sonucunu basarisiz yapmiyor.

## Prompttan artefakta kontrol listesi

| Gereksinim | Artefakt veya kod yuzu | Test veya kanit | Durum |
| --- | --- | --- | --- |
| Electron masaustu kabugu oncelikli rota olsun | `electron/main.mjs`, `electron/runtime.mjs`, `electron/preload.cjs`, `package.json` `desktop:*`, `README.md` hizli baslatma | `desktop-smoke`, `electron-smoke-launch`, `desktop:flow`, Windows launcher dry-run | Kapali |
| Eski tarayici/admin paneli hissi azaltilsin, ilk ekran Proje Calisma Merkezi olsun | `src/main.js` varsayilan `workspace`, `renderWorkspace`, status bar, proje rayi, timeline, context panel, activity log | `scripts/electron-flow-smoke.mjs` calisma merkezi, timeline, context panel, activity log metinlerini dogrular | Kapali |
| Tum gorunur UI Turkce olsun | `src/main.js`, `README.md`, `scripts/smoke-dist.mjs` beklenen Turkce metinler ve yasakli eski terimler | `smoke-dist.mjs` UI metinlerini ve eski terim yoklugunu denetler | Kapali, fakat tam dogal dil denetimi manuel kalir |
| Eski terimler temizlensin | `smoke-dist.mjs` `AI Inbox`, `Work Board`, `Context Pack`, `Triage`, `Repo Baglantisi` gibi terimleri build icinde yasaklar | `npm run smoke`, `npm run verify` | Kapali |
| GitHub work-memory kaynak gerceklik olarak kalsin | `src/github.js`, `src/storage.js`, `README.md`, `docs/memory-format.md` | `tests/github.test.js`, cache scope testleri | Kapali |
| Yerel cache, mirror ve GitHub farki UI'da gorunsun | `src/main.js` `renderMemorySyncPanel`, `buildSyncSnapshot`; `scripts/ctxlab-runner.mjs` mirror/index | `desktop:flow` hafiza senkron fark durumunu dogrular; runner unit testleri mirror durumlarini kapsar | Kapali |
| Yerel mirror `%APPDATA%/ctx-lab/memory`, run loglari `%APPDATA%/ctx-lab/runs` altinda olsun | `scripts/ctxlab-runner.mjs` `buildRunnerPaths`, `README.md` | `runner:check`, runner path unit testleri, Windows dry-run ciktisi | Kapali |
| Proje klasoru uygulamadan secilebilsin | Electron IPC `selectProjectDirectory`, onboarding proje formu | `desktop-runtime.test.js`, `desktop:flow` proje kokunu kaydetme adimi | Kapali |
| Codex yalniz kayitli proje koklerinde calissin | `registerProject`, `startCodexRun`, allowlist kontrolleri | `runner.test.js` kayitsiz kok, credential/system path ret testleri | Kapali |
| Codex CLI tespiti ve surum kontrolu | `detectCodex`, `buildHealthPayload`, Electron runtime health | `runner.test.js`, Windows dry-run `codex.cmd` ve `codex-cli 0.130.0` kaniti | Kapali |
| Codex dry-run, prompt template, run baslatma, stdout/stderr log | `startCodexRun`, `buildCodexRunPrompt`, `listCodexRunEvents` | `runner.test.js` gercek calisma mock'u, JSONL olay gunlugu, `desktop:flow` Codex deneme kaydi | Kapali |
| Otomasyon seviyeleri | `src/main.js` select opsiyonlari, `scripts/ctxlab-runner.mjs` `AUTOMATION_LEVELS` | `runner.test.js`, `desktop:flow` form ve commit/push onay kapisi | Kapali |
| Destructive git islemleri kapali | `rejectUnsafePrompt`, commit/push prompt retleri | `runner.test.js` destructive git ve commit/push isteyen prompt testleri | Kapali |
| Commit/push oncesi ozet ve test sonucu gorunsun | `buildCommitDraft`, `renderRunEvidence`, `applyCodexRunCommit` | `runner.test.js`, `desktop:flow` commit/push onay kapisi | Kapali |
| GitHub tani: repo, branch, config, klasorler, yazma testi | `diagnoseMemoryRepo`, `ensureMemoryRepo` | `github.test.js`, onboarding `desktop:flow` GitHub mock'u | Kapali, canli private repo yazma testi opsiyonel |
| Opsiyonel canli GitHub tani komutu | `scripts/github-live-diagnostics.mjs`, `npm run github:diagnose`, `README.md`, `.github/workflows/verify.yml` | `github-live-diagnostics.test.js`; CI token yokken ag cagrisina cikmadan skip adimini calistirir, token varken gercek `diagnoseMemoryRepo`; CLI metinleri dogal Turkce tutulur | Kapali; CI token saglamadigi icin canli private repo yazma testi opsiyonel |
| 404/403 hata aciklamalari Turkce olsun | `github.js` hata esleme | `github.test.js` 403 ve 404 testleri | Kapali |
| Markdown/frontmatter geriye uyumlu kalsin | `src/domain.js` parser, serializer, aliaslar | `domain.test.js`, `docs/memory-format.md` | Kapali |
| Timeline event katmani eklensin | `buildTimelineEvents`, `renderWorkspace`, timeline filtreleri | `domain.test.js`, `desktop:flow` timeline filtreleri | Kapali |
| Codex run, GitHub sync, status degisimi timeline'a girsin | `buildTimelineEvents`, `persistCodexRunMemoryLink`, `status_history` | `domain.test.js`, `desktop:flow` Codex ve handoff filtreleri | Kapali |
| Validation panel duplicate id, eksik status, bozuk frontmatter gostersin | `validateMemoryRecords`, `renderValidationPanel` | `domain.test.js`, `desktop:flow` hafiza sagligi uyarilari | Kapali |
| `claude-review.md` P0/P1 UX notlari uygulansin | Command palette, activity log, dark/light theme, keyboard shortcuts, drag/drop, onboarding, durum gorunurlugu | `desktop:flow`, `smoke-dist`, CSS reduced motion kontrolleri | Buyuk olcude kapali; gorsel kalite manuel inceleme gerektirir |
| Onboarding akisi | `renderOnboarding`, `buildOnboardingChecklist`, `finishOnboarding` | `domain.test.js`, `desktop:flow` ilk kurulum, repo tani, mirror, proje koku, Codex kontrolu, ornek brif | Kapali |
| App icon, menu/tray opsiyonu | `electron/assets/icon.ico`, `electron/main.mjs` menu ve tray | `desktop:pack:smoke`, Electron boot smoke | Kapali |
| Guvenli IPC sinirlari | `preload.cjs`, `runtime.mjs`, `DESKTOP_IPC_CHANNELS` | `desktop-runtime.test.js` izinli kanal testi | Kapali |
| Production build ve Windows paketleme hazirligi | `electron-builder.yml`, `desktop:pack`, `desktop:dist` | `desktop:pack:smoke`, CI `desktop-verify` | Kapali |
| Gorsel regression/screenshot kontrolleri | `electron-flow-smoke.mjs` PNG decode, renk/kontrast, workspace bolge geometrisi, viewport kontrolleri ve screenshot metrik JSON'u; CI screenshot + metrik artefakti | `desktop:flow`, `desktop-verify` artefakt yukleme | Kapali, fakat pixel baseline/regression arsivi yok |

## Bilinen zayif kanitlar

1. Canli GitHub private repo yazma testi CI icinde mock'lanir veya token yoksa opsiyonel script tarafindan atlanir. `npm run github:diagnose` token verildiginde gercek Contents API yazma/silme testi yapar, fakat CI'da token kullanilmadigi icin canli private repo uzerinde zorunlu dogrulama yoktur.
2. Gorsel kalite icin screenshot smoke nonblank/kontrast, layout geometrisi ve metrik JSON'u uretir; CI screenshot artefakti manuel inceleme icin saklanir. Tasarimin "profesyonel masaustu araci gibi gorunmesi" halen kismen manuel degerlendirme ister.
3. `claude-review.md` untracked oldugu icin kanit olarak commitlenmez. Bu belge P0/P1 maddelerinin urune yansiyan kisimlarini izler, fakat kaynak review dosyasi bilerek repo disinda kalir.
4. Tum UI Turkce hedefi smoke ile eski terim, onboarding, hafiza senkron, validation ve kritik aksiyon metinleri duzeyinde korunur; tum bundle icin dogal Turkce denetimi tam otomatik degildir.

## Sonraki somut adaylar

1. Turkce dogal dil denetimi icin smoke listesini ileride hata banner'lari ve nadir kenar durum metinleriyle genisletmek.
2. Pixel baseline gerektiren tam gorsel regression arsivi icin ileride ek artefakt karsilastirma kapisi.
