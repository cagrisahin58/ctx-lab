# ctx-lab

ctx-lab, Claude Code ve Codex gibi AI araçlarıyla çalışırken insan bağlamının kopmasını azaltmak için tasarlanan GitHub destekli çalışma hafızası uygulamasıdır.

## Ana fikir

AI sohbet geçmişine güvenmek yerine, her önemli oturumdan sonra kısa ve insan-onaylı bir özet özel bir GitHub hafıza reposuna yazılır. ctx-lab bu repo'yu okuyarak:

- Oturum Akışı'nda yeni oturum özetlerini toplar,
- Oturum Akışı'nda proje, repo, etiket ve güncellik sinyallerine göre mevcut iş hattı önerir,
- İş Akışı'nda aktif işleri gösterir,
- İş Akışı hatlarını sürükle-bırak ile durumlar arasında taşır,
- sol proje rayındaki hızlı filtrelerle işleme bekleyen oturumlara, aktif/bekleyen/engelli iş hatlarına ve Codex kayıtlarına tek tıkla gider,
- aynı proje için gelen yeni oturumları mevcut iş hattına bağlar,
- karar defterini kaynaklı tutar,
- Codex veya Claude için iş hattı merkezli, içerik metrikleri görünen devam brifi üretir.
- `Ctrl+K` komut paletiyle görünüm, proje, GitHub yenileme ve Codex çalıştırıcı aksiyonlarına hızlı erişim sağlar.
- Açık/koyu tema tercihini yerelde saklar.
- Hafıza Sağlığı panelinde duplicate id, eksik alan ve bilinmeyen status uyarılarını gösterir.
- Hafıza Senkron Durumu panelinde GitHub önbelleği, yerel ayna ve indeks farkını açıkça gösterir.

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

Bu komut gerekiyorsa bağımlılıkları kurar, `127.0.0.1:5173` üzerinde Vite dev server başlatır ve Electron masaüstü kabuğunu açar. Alternatif port için `.\scripts\start-windows.cmd -Port 5175` kullanılabilir.

Varsayılan Windows launcher artık Electron masaüstü kabuğunu açar; çalıştırıcı işlemleri Electron main process IPC yüzeyinden yürür. Hızlı kontrol için `.\scripts\start-windows.cmd -DryRun` çalıştırıcı sağlığı ve masaüstü smoke kapısını çalıştırır. Eski tarayıcı + localhost çalıştırıcı akışı gerektiğinde `.\scripts\start-windows.cmd -Web` kullanılabilir.

Masaüstü geliştirme kabuğu:

```bash
npm run desktop:dev
```

Bu komut Vite dev server'ını başlatır ve Electron kabuğunu güvenli preload/IPC yüzeyiyle açar. Production smoke için:

```bash
npm run desktop:smoke
```

Electron kabuğu renderer tarafında Node entegrasyonunu kapalı tutar; proje klasörü seçimi, çalıştırıcı sağlığı, proje registry ve Codex çalıştırma kayıtları yalnızca izinli IPC kanallarından geçer.

Windows paketleme hazırlığı:

```bash
npm run icon:generate
npm run desktop:pack
npm run desktop:pack:smoke
npm run desktop:dist
```

`icon:generate` bağımlılık eklemeden `electron/assets/icon.ico` dosyasını üretir. `desktop:pack` production renderer çıktısını `release/win-unpacked` altında paketlenmiş Electron klasörü olarak hazırlar. `desktop:pack:smoke` bu klasördeki `ctx-lab.exe` ve `app.asar` dosyalarını doğrular, ardından paketlenmiş uygulamayı `--smoke` ile açıp production shell'in yüklendiğini kontrol eder. `desktop:dist` aynı yapılandırmayla Windows portable artefact üretir. Paketleme çıktıları git dışında tutulur.

Kullanıcı seviyesindeki masaüstü akışını doğrulamak için:

```bash
npm run desktop:flow
```

Bu kontrol Electron'u izole bir kullanıcı veri klasörüyle açar; ilk kurulum ekranını, yerel proje kökü kaydını, örnek devam brifi üretimini, demo veriden çalışma merkezine geçişi, `Ctrl+K` komut paletiyle ana görünümleri, Codex deneme kaydı oluşturmayı, çalıştırma sonucunun hafızaya ve devam brifi kaynaklarına bağlanmasını, commit/push onay kapısını, hafıza sağlığı uyarılarını, yerel ayna fark görünürlüğünü ve ekran görüntüsü alınabildiğini doğrular.

Masaüstü kapısını toplu çalıştırmak için:

```bash
npm run verify:desktop
```

Bu komut Electron güvenlik/IPC smoke kontrolünü ve kullanıcı seviyesindeki masaüstü akışını birlikte çalıştırır. GitHub Actions aynı kapıyı Windows runner üzerinde statik smoke, Electron boot smoke ve kullanıcı akışı olarak ayrı adımlarda çalıştırır; ek olarak Windows launcher deneme kontrolünü yapar.

İlk açılışta `Kısa Kurulum` ekranı hafıza reposu bağlantısı, repo tanılaması, yerel ayna/indeks, proje kökü, Codex CLI kontrolü ve örnek devam brifi adımlarını tek akışta gösterir. Kurulum tamamlandığında kullanıcı doğrudan `Proje Çalışma Merkezi` ekranına geçer.

Kalite kapısı:

```bash
npm run verify
```

Bu komut unit testleri, production build'i ve `dist/` smoke kontrolünü çalıştırır. Aynı kapı GitHub Actions üzerinde `main` push'ları ve pull request'ler için de çalışır.

## GitHub hafıza reposu kurulumu

Özel hafıza reposu için fine-grained GitHub token önerilir:

- Repository access: sadece hafıza reposu
- Permissions: Contents read/write

Uygulamada `Hafıza Bağlantısı` ekranından owner/repo, dal ve token girilir. `Hafıza Yapısını Hazırla` düğmesi şu yapıyı otomatik oluşturur:
`Bağlantıyı Tanıla` düğmesi repo erişimi, dal, `config.yaml`, hafıza klasörleri ve gerçek Contents yazma iznini kontrol eder. Yazma testi geçici `archive/.ctxlab-write-test` dosyası oluşturup siler. 403/404 gibi GitHub hataları owner/repo, dal, özel repo erişimi ve Contents read/write izni açısından Türkçe açıklanır.
Token alanı varsayılan olarak maskelenir; kullanıcı gerektiğinde aynı alandan geçici olarak görünür hale getirebilir. Onboarding ve Hafıza Bağlantısı ekranlarında fine-grained token üretimi için kısa rehber ve GitHub token ekranı bağlantısı bulunur.

```text
work-memory/
  inbox/
  work_items/
  decisions/
  handoffs/
  archive/
  config.yaml
```

Token ve son başarılı hafıza anlık görüntüsü yalnızca tarayıcı localStorage alanında saklanır. Sunucu tarafı yoktur. Yerel önbellek owner/repo/dal kapsamıyla ayrılır; uygulama açıldığında son kayıtları hızlı gösterir, GitHub ise kaynak gerçeklik olarak kalır. Son görülen dal HEAD değeri de önbellekte tutulur; yazmadan önce GitHub dalı dışarıdan güncellendiyse ctx-lab yazımı durdurur ve `GitHub'dan Yenile` çağrısı gösterir.

## Yerel Codex Çalıştırıcı

Electron masaüstü kabuğunda yerel çalıştırıcı omurgası main process içindeki güvenli IPC kanallarından yürür; aynı çalışma zamanı fonksiyonları `scripts/ctxlab-runner.mjs` içinde tutulur. Web fallback için `.\scripts\start-windows.cmd -Web` kullanıldığında bu modül yalnızca `127.0.0.1` üzerinde HTTP servisi olarak açılır ve geçici `x-ctxlab-runner-token` header'ı ile korunur. Her iki yüzey de Codex CLI durumunu denetler, `%APPDATA%/ctx-lab` altında yerel hafıza klasörlerini hazırlar ve otomasyon kapsamına alınacak proje köklerini `projects.json` dosyasında tutar.

`Yerel Codex Çalıştırıcı` ekranında çalıştırıcı sağlığı, Codex CLI sürümü ve kayıtlı proje kökleri görülür. Bir proje kökü kaydedilmeden Codex otomasyonu o klasörde dosya değiştirmeyecek şekilde tasarlanır.

Codex çalıştırma kayıtları `%APPDATA%/ctx-lab/runs` altında JSON günlük olarak tutulur. Gerçek Codex çalışmalarında aynı klasöre ek olarak `*.events.jsonl` stdout/stderr olay günlüğü yazılır. İlk masaüstü akışta deneme kaydı varsayılandır; prompt, otomasyon seviyesi, proje allowlist bilgisi, stdout/stderr, çıkış kodu, test sonucu sinyali, Git başlangıç/sonuç snapshot'ı ve çalışma özeti aynı çalıştırma kaydına yazılır. Desteklenen seviyeler: sadece brif hazırla, öneri üret, dosya değiştir ama commit atma, test çalıştır, commit hazırla, commit + push. Çalıştırma formundaki `Otomasyon sınırları` bölümü her seviyenin deneme, `read-only` veya `workspace-write` etkisini kullanıcıya açıkça gösterir. Geri alıcı veya silici Git kalıpları (`reset --hard`, `clean -f`, `checkout --`, `restore`, force/delete push gibi) çalıştırıcı tarafında reddedilir. `commit + push` gerçek çalışmada ayrıca açık onay verilmezse çalıştırıcı Codex'i başlatmaz ve çalıştırma kaydını `blocked` olarak yazar. UI'daki `Çalıştırma Kanıtı` alanı günlük yolunu, test sonucunu, Git durumunu, dosya bazlı `Değişiklik Özeti` bölümünü, çıktı özetini, güvenli IPC/HTTP sözleşmesiyle yenilenebilen son stdout/stderr olaylarını gösteren `Olay Akışı` bölümünü, `Commit Hazırlığı` uygunluk kontrolünü, yapılandırılmış `Commit Taslağı` bölümünü ve commit/push öncesi kapıyı görünür tutar. Commit taslağı yalnızca başarılı run, başarılı test sinyali ve değişmeyen Git snapshotı doğrulanırsa ayrı kullanıcı onayıyla uygulanır; push için ayrıca push onayı gerekir.

Çalıştırma sonucu seçili iş hattına bağlanabilir. Bu durumda ctx-lab `handoffs/` altında `kind: codex_run` içeren kaynaklı bir kayıt oluşturur ve ilgili iş hattının `codex_runs` frontmatter listesini günceller. Böylece Codex otomasyonu yalnızca yerel günlükte kalmaz, GitHub work-memory zaman akışı içinde de görünür hale gelir.

Yerel hafıza aynası `%APPDATA%/ctx-lab/memory/git` altında, türetilmiş indeks ise `%APPDATA%/ctx-lab/memory/index` altında tutulur. Ayna akışı GitHub token'ını çalıştırıcıya taşımaz; `git clone/fetch/pull` yerel Git/Git Credential Manager yetkileriyle çalışır. İndeks, mevcut markdown/frontmatter kayıtlarını okuyup masaüstü zaman akışı ve sağlık görünürlüğü için özet JSON üretir.

## Manuel oturum özeti akışı

`Yeni Oturum Özeti` ekranı, Codex veya Claude oturumundan sonra temiz bir kayıt üretir. Ekrandaki `Oturum Kapanış Prompt'u` AI sohbetine yapıştırıldığında ctx-lab formatında markdown özet alınır. Bu markdown `Hazır Markdown` alanına yapıştırılıp doğrudan `inbox/` altına kaydedilebilir.

Kayıtlar timestamp içeren benzersiz dosya adıyla yazılır. Oturum Akışı'ndan `İş Hattına Bağla` seçildiğinde aynı proje için var olan iş hattı varsa yeni session id o hatta eklenir; yoksa yeni hat oluşturulur.
Gerekirse oturum detayındaki seçiciden mevcut bir iş hattı bilinçli olarak hedeflenebilir; bu durumda oturum özeti seçili iş hattının `sessions` listesine eklenir.
Oturum Akışı varsayılan olarak yalnızca işleme bekleyen kayıtları gösterir; bağlı, arşivlenmiş veya tüm kayıtlar durum filtresiyle açılabilir.
Arşivlenen kayıtlar archive klasörüne `archived` statüsüyle taşınır, böylece yeniden senkronizasyonda işleme bekleyen kayıt listesine geri düşmez.

## Devam brifi akışı

`İş Akışı` ekranında seçili iş hattı için bağlı oturumlar, karar kayıtları, güncel durum, sıradaki adım ve çalışma kuralları tek bir devam brifinde birleştirilir. `Devam Brifi`, kaynak iş hattını veya oturum kaydını ve hedef aracı (`Codex` ya da `Claude Code`) açıkça seçtirir. Bu metin doğrudan kopyalanabilir veya `handoffs/` altına kaydedilebilir. Amaç, temiz bir Codex/Claude oturumunda sohbet geçmişi kaybolsa bile insan çalışma bağlamını hızlı geri yüklemektir.
`Günlük Devam Brifi` ekranı tüm açık iş hatlarını, engelli/bekleyen işleri ve işleme bekleyen kayıtları tek metinde toplar; bu brif kopyalanabilir veya devam brifi olarak kaydedilebilir.

İş hatları `Aktif`, `Beklemede`, `Engelli` ve `Tamamlandı` durumları arasında doğrudan panodan taşınabilir. Panodaki `Yeni İş Hattı` akışı, oturum akışını beklemeden bağımsız bir çalışma hattı açar. Arama alanı Oturum Akışı, İş Akışı ve Karar Defteri içinde proje, başlık, repo, durum, kaynak ve etiket bilgilerine göre hızlı süzme yapar.
İş hattının `Sonraki Adım` alanı panodan güncellenebilir; devam brifi bu güncel değeri kullanır.
`Karar Defteri` ekranındaki `Yeni Karar` akışı, oturum geçmişinden bağımsız kaynaklı karar kaydı oluşturur ve seçili iş hattına bağlayabilir.
Karar ve devam brifi kayıtları tekrar kaydedildiğinde mevcut dosya güncellenir; aynı kayıt için gereksiz kopyalar üretilmez.
Oturum kaydından karar çıkarıldığında veya manuel karar bir iş hattına bağlandığında karar id'si o iş hattına otomatik eklenir.
GitHub yazımlarında stale `sha` hatası alınırsa uygulama dosyanın son `sha` değerini okuyup yazımı bir kez yeniden dener.

Detaylı format için [docs/memory-format.md](docs/memory-format.md) dosyasına bakın.
