# ctx-lab v2 hedefi

Bu belge, ctx-lab'in ikinci faz hedefini repo icinde kalici hale getirir. Resmi goal araci bu thread icinde ikinci goal acmaya izin vermedigi icin, uygulama hedefi burada takip edilir.

## Ana hedef

ctx-lab v2, GitHub destekli hafiza katmanini koruyarak proje zaman akisi merkezli, Turkce, workflow odakli ve yerel Codex calistirici ile tam otonom calisabilen bir uygulama olacak.

## Kararlar

- Ana gorunum: Proje Zaman Akisi.
- Otonomi: Codex dosya degistirebilir, test calistirabilir, commit atabilir ve push yapabilir.
- Calistirici: Electron main process IPC yuzeyi ve geriye uyumluluk icin `127.0.0.1` Node localhost servisi.
- Yerel hafiza: hem app-data indeks hem yerel git clone aynasi.
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

- Calistirici app-data dizini:
  - Windows: `%APPDATA%/ctx-lab`
  - diger platformlar: `~/.ctx-lab`
- Yerel ayna:
  - `memory/git/`
  - `memory/index/`
  - `runs/`
  - `projects.json`
- Calistirici gorevleri:
  - health check
  - proje kayitlarini yonetme
  - hafiza reposu clone/pull/push
  - app-data indeks yenileme
  - `codex.cmd exec --json` calistirma
  - Codex sonucunu calistirma kaydina ve work-memory dosyalarina yazma
  - proje repo commit/push islemleri; yalniz hazir commit taslagi, basarili test sinyali ve degismemis Git snapshoti onaylanirsa
- Guvenlik sinirlari:
  - sadece `127.0.0.1`
  - kayitli proje kokleri allowlist
  - calistirici token
  - destructive git ve credential dosyalarina erisim yasak
  - dogrulama komutlari ve calistirma gunlugu zorunlu

## Uygulama asamalari

1. Calistirici temeli: health, app-data dizinleri, Codex CLI tespiti, proje registry.
2. Electron kabugu: guvenli preload/IPC, app-data path, klasor secimi, desktop smoke.
3. Memory ayna: work-memory clone/pull/indeks. Ilk kesitte token calistiriciya tasinmadan Git/GCM uzerinden clone/fetch/pull ve JSON indeks uretimi yapilir.
4. Proje zaman akisi veri modeli: legacy kayitlardan, is hatti durum gecmisinden, senkron olaylarindan ve Codex run/commit uygulamalarindan timeline event uretimi.
5. UI yenileme: Turkce terminoloji, zaman akisi, command rail, durum cubugu.
6. Codex calistirma kaydi: hazir promptlar, deneme kaydi, JSONL stdout/stderr gunlugu, commit/push oncesi gorunur ozet ve yapilandirilmis commit taslagi.
7. Onboarding: hafiza reposu, repo tanilama, yerel ayna/indeks, proje koku, Codex CLI ve ornek devam brifi tek akista dogrulanir.
8. claude-review P0 UX paketi: dark mode, command palette, activity log, kisa yollar.

## Test kapisi

- `npm test`
- `npm run build`
- `npm run smoke`
- `npm run verify`
- calistirici unit testleri
- calistirici deneme saglik kontrolu
- Windows launcher deneme kontrolu
- Electron desktop smoke ve kullanici seviyesi desktop flow
- GitHub Actions web verify ve Windows desktop verify
