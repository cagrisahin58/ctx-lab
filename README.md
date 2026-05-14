# ctx-lab

ctx-lab, Claude Code ve Codex gibi AI araçlarıyla çalışırken insan bağlamının kopmasını azaltmak için tasarlanan GitHub-backed çalışma hafızası uygulamasıdır.

## Ana fikir

AI sohbet geçmişine güvenmek yerine, her önemli oturumdan sonra kısa ve insan-onaylı bir özet özel bir GitHub memory repo'ya yazılır. ctx-lab bu repo'yu okuyarak:

- Oturum Akışı'nda yeni oturum özetlerini toplar,
- İş Akışı'nda aktif işleri gösterir,
- aynı proje için gelen yeni oturumları mevcut iş kartına bağlar,
- karar defterini kaynaklı tutar,
- Codex veya Claude için iş hattı merkezli devam brifi üretir.

Uygulama tamamen Türkçe arayüzle gelir. Veri alanları teknik sebeplerle İngilizce kalabilir, ancak kullanıcıya görünen metinler Türkçedir.

## Hızlı başlatma

```bash
npm install
npm run dev
```

Sonra tarayıcıda Vite'ın verdiği yerel adresi açın. Bu geliştirme ortamında varsayılan adres `http://127.0.0.1:5173`.

Windows için tek komut:

```powershell
.\scripts\start-windows.cmd
```

Bu komut gerekiyorsa bağımlılıkları kurar, `127.0.0.1:5173` üzerinde dev server başlatır, `127.0.0.1:5174` üzerinde yerel Codex Runner'ı açar ve tarayıcıyı başlatır. Alternatif port için `.\scripts\start-windows.cmd -Port 5175 -RunnerPort 5176` kullanılabilir.

Masaüstü geliştirme kabuğu:

```bash
npm run desktop:dev
```

Bu komut Vite dev server'ını başlatır ve Electron kabuğunu güvenli preload/IPC yüzeyiyle açar. Production smoke için:

```bash
npm run desktop:smoke
```

Electron kabuğu renderer tarafında Node entegrasyonunu kapalı tutar; proje klasörü seçimi, runner sağlığı, proje registry ve Codex run kayıtları yalnızca izinli IPC kanallarından geçer.

Kalite kapısı:

```bash
npm run verify
```

Bu komut unit testleri, production build'i ve `dist/` smoke kontrolünü çalıştırır. Aynı kapı GitHub Actions üzerinde `main` push'ları ve pull request'ler için de çalışır.

## GitHub memory repo kurulumu

Private memory repo için fine-grained GitHub token önerilir:

- Repository access: sadece memory repo
- Permissions: Contents read/write

Uygulamada `Hafıza Bağlantısı` ekranından owner/repo, branch ve token girilir. `Repo Yapısını Hazırla` düğmesi şu yapıyı otomatik oluşturur:
`Bağlantıyı Tanıla` düğmesi repo erişimi, branch, `config.yaml`, memory klasörleri ve gerçek Contents yazma iznini kontrol eder. Yazma testi geçici `archive/.ctxlab-write-test` dosyası oluşturup siler.

```text
work-memory/
  inbox/
  work_items/
  decisions/
  handoffs/
  archive/
  config.yaml
```

Token ve son başarılı memory snapshot'ı yalnızca tarayıcı localStorage alanında saklanır. Sunucu tarafı yoktur. Yerel önbellek owner/repo/branch kapsamıyla ayrılır; uygulama açıldığında son kayıtları hızlı gösterir, GitHub ise kaynak gerçeklik olarak kalır.

## Yerel Codex Runner

v2 ile `start-windows` komutu ayrıca `scripts/ctxlab-runner.mjs` servislerini başlatır. Runner yalnızca `127.0.0.1` üzerinde çalışır; Codex CLI durumunu denetler, `%APPDATA%/ctx-lab` altında yerel hafıza klasörlerini hazırlar ve otomasyon kapsamına alınacak proje köklerini `projects.json` dosyasında tutar.

`Yerel Codex Runner` ekranında runner sağlığı, Codex CLI sürümü ve kayıtlı proje kökleri görülür. Bir proje kökü kaydedilmeden Codex otomasyonu o klasörde dosya değiştirmeyecek şekilde tasarlanır.

Codex run kayıtları `%APPDATA%/ctx-lab/runs` altında JSON log olarak tutulur. İlk masaüstü akışta dry-run varsayılandır; prompt, otomasyon seviyesi, proje allowlist bilgisi ve çalışma sonucu aynı run kaydına yazılır. Desteklenen seviyeler: sadece brif hazırla, öneri üret, dosya değiştir ama commit atma, test çalıştır, commit hazırla, commit + push. Destructive git komutları runner tarafında reddedilir.

Yerel memory mirror `%APPDATA%/ctx-lab/memory/git` altında, türetilmiş index ise `%APPDATA%/ctx-lab/memory/index` altında tutulur. Mirror akışı GitHub token'ını runner'a taşımaz; `git clone/fetch/pull` yerel Git/Git Credential Manager yetkileriyle çalışır. Index, mevcut markdown/frontmatter kayıtlarını okuyup masaüstü timeline ve sağlık görünürlüğü için özet JSON üretir.

## Manuel oturum özeti akışı

`Yeni Oturum Özeti` ekranı, Codex veya Claude oturumundan sonra temiz bir kayıt üretir. Ekrandaki `Oturum Kapanış Prompt'u` AI sohbetine yapıştırıldığında ctx-lab formatında markdown özet alınır. Bu markdown `Hazır Markdown` alanına yapıştırılıp doğrudan `inbox/` altına kaydedilebilir.

Kayıtlar timestamp içeren benzersiz dosya adıyla yazılır. Oturum Akışı'ndan `İş Kartına Bağla` seçildiğinde aynı proje için var olan iş kartı varsa yeni session id o karta eklenir; yoksa yeni kart oluşturulur.
Gerekirse oturum detayındaki seçiciden mevcut bir iş hattı bilinçli olarak hedeflenebilir; bu durumda oturum özeti seçili iş kartının `sessions` listesine eklenir.
Oturum Akışı varsayılan olarak yalnızca işleme bekleyen kayıtları gösterir; bağlı, arşivlenmiş veya tüm kayıtlar durum filtresiyle açılabilir.
Arşivlenen kayıtlar archive klasörüne `archived` statüsüyle taşınır, böylece yeniden senkronizasyonda işleme bekleyen kayıt listesine geri düşmez.

## Devam brifi akışı

`İş Akışı` ekranında seçili iş kartı için bağlı oturumlar, karar kayıtları, güncel durum, sıradaki adım ve çalışma kuralları tek bir devam brifinde birleştirilir. `Devam Brifi`, kaynak iş hattını veya oturum kaydını ve hedef aracı (`Codex` ya da `Claude Code`) açıkça seçtirir. Bu metin doğrudan kopyalanabilir veya `handoffs/` altına kaydedilebilir. Amaç, temiz bir Codex/Claude oturumunda sohbet geçmişi kaybolsa bile insan çalışma bağlamını hızlı geri yüklemektir.
`Günlük Devam Brifi` ekranı tüm açık iş hatlarını, engelli/bekleyen işleri ve işleme bekleyen kayıtları tek metinde toplar; bu brif kopyalanabilir veya devam brifi olarak kaydedilebilir.

İş kartları `Aktif`, `Beklemede`, `Engelli` ve `Tamamlandı` durumları arasında doğrudan panodan taşınabilir. Panodaki `Yeni İş Hattı` akışı, oturum akışını beklemeden bağımsız bir çalışma hattı açar. Arama alanı Oturum Akışı, İş Akışı ve Karar Defteri içinde proje, başlık, repo, durum, kaynak ve etiket bilgilerine göre hızlı süzme yapar.
İş kartının `Sonraki Adım` alanı panodan güncellenebilir; devam brifi bu güncel değeri kullanır.
`Karar Defteri` ekranındaki `Yeni Karar` akışı, oturum geçmişinden bağımsız kaynaklı karar kaydı oluşturur ve seçili iş hattına bağlayabilir.
Karar ve devam brifi kayıtları tekrar kaydedildiğinde mevcut dosya güncellenir; aynı kayıt için gereksiz kopyalar üretilmez.
Oturum kaydından karar çıkarıldığında veya manuel karar bir iş hattına bağlandığında karar id'si o iş hattına otomatik eklenir.
GitHub yazımlarında stale `sha` hatası alınırsa uygulama dosyanın son `sha` değerini okuyup yazımı bir kez yeniden dener.

Detaylı format için [docs/memory-format.md](docs/memory-format.md) dosyasına bakın.
