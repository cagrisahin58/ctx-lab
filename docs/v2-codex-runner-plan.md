# ctx-lab v2 hedefi

Bu belge, ctx-lab'in ikinci faz hedefini repo icinde kalici hale getirir. Resmi goal araci bu thread icinde ikinci goal acmaya izin vermedigi icin, uygulama hedefi burada takip edilir.

## Ana hedef

ctx-lab v2, GitHub-backed hafiza katmanini koruyarak proje timeline merkezli, Turkce, workflow odakli ve yerel Codex Runner ile tam otonom calisabilen bir uygulama olacak.

## Kararlar

- Ana gorunum: Proje Timeline.
- Otonomi: Codex dosya degistirebilir, test calistirabilir, commit atabilir ve push yapabilir.
- Runner: Electron main process IPC yuzeyi ve geriye uyumluluk icin `127.0.0.1` Node localhost servisi.
- Yerel hafiza: hem app-data indeks hem yerel git clone mirror.
- API: ilk v2 icin OpenAI API sart degil; Codex CLI (`codex.cmd exec`) kullanilacak.
- Dil: gorunur tum metinler Turkce olacak; dahili field ve klasor adlari geriye uyumluluk icin Ingilizce kalabilir.

## UX ve icerik ilkeleri

- `claude-review.md` P0/P1 notlari yeni workflow modeline uyarlanacak.
- Eski CRUD/admin hissi yerine proje/oturum evrimi gosterilecek.
- Kayit kartlarinda gereksiz baslik yiginlari kaldirilacak.
- Ana ozet icin su bilgiler yeterli kabul edilecek:
  - proje adi
  - repo
  - sohbet/oturum adi
  - guncel durum ozeti
- Terim hedefleri:
  - `AI Inbox` yerine `Oturum Akisi`
  - `Work Board` yerine `Is Akisi`
  - `Handoff` yerine `Devam Brifi`
  - `Context Pack` yerine `Baglam Paketi` veya ekranda dogrudan `Devam Brifi`
  - `Triage` yerine `Isleme Bekliyor`
  - `Session Summary` yerine `Oturum Ozeti`

## Teknik kapsam

- Runner app-data dizini:
  - Windows: `%APPDATA%/ctx-lab`
  - diger platformlar: `~/.ctx-lab`
- Yerel mirror:
  - `memory/git/`
  - `memory/index/`
  - `runs/`
  - `projects.json`
- Runner gorevleri:
  - health check
  - proje kayitlarini yonetme
  - memory repo clone/pull/push
  - app-data indeks yenileme
  - `codex.cmd exec --json` calistirma
  - Codex sonucunu run kaydina ve work-memory dosyalarina yazma
  - proje repo commit/push islemleri
- Guvenlik sinirlari:
  - sadece `127.0.0.1`
  - kayitli proje kokleri allowlist
  - runner token
  - destructive git ve credential dosyalarina erisim yasak
  - dogrulama komutlari ve run log zorunlu

## Uygulama asamalari

1. Runner temeli: health, app-data dizinleri, Codex CLI tespiti, proje registry.
2. Electron kabugu: guvenli preload/IPC, app-data path, klasor secimi, desktop smoke.
3. Memory mirror: work-memory clone/pull/index. Ilk kesitte token runner'a tasinmadan Git/GCM uzerinden clone/fetch/pull ve JSON index uretimi yapilir.
4. Proje Timeline veri modeli: legacy kayitlardan timeline event uretimi.
5. UI yenileme: Turkce terminoloji, timeline, command rail, durum cubugu.
6. Codex run: hazir promptlar, dry-run, JSONL stdout/stderr log, commit/push oncesi gorunur ozet.
7. claude-review P0 UX paketi: dark mode, command palette, activity log, kisa yollar, onboarding.

## Test kapisi

- `npm test`
- `npm run build`
- `npm run smoke`
- `npm run verify`
- runner unit testleri
- runner dry-run health check
- Windows launcher dry-run
- GitHub Actions verify
