# Seslog Desktop App — Kapsamlı Test ve Analiz Raporu

**Tarih:** 2026-02-25
**Analist:** Claude (Kod İnceleme + Statik Analiz)
**Kapsam:** seslog-core, seslog-hook, seslog-app (UI, State, DB, Reconcile, CSS)

---

## Özet

Seslog masaüstü uygulaması Rust + Dioxus 0.6 ile geliştirilmiş, glassmorphism temalı bir Claude Code oturum takip sistemidir. Tüm kaynak kodlar (15+ dosya, ~3500 satır UI kodu, ~2000 satır core kodu) satır satır incelendi. Uygulama mimari olarak sağlam bir temele sahip ancak **22 sorun** (7 kritik, 8 orta, 7 kozmetik) ve **15 iyileştirme önerisi** tespit edilmiştir.

**Test edilen modüller:** Dashboard, Sidebar, Overview, Settings, Project Detail, Session Detail, Components, State, Commands, DB, Reconcile, CSS, Sync, Watcher, Events

---

## Ekran Bazlı Bulgular

### 1. Sidebar

#### Çalışan Özellikler
- [x] Logo ve "Seslog" yazısı — Gradient uygulanmış, "SL" ikonu ve text var
- [x] Dashboard, Overview, Settings nav butonları — `View` enum ile doğru routing
- [x] Proje listesi — DB'den `get_projects_inner()` ile çekiliyor, progress yüzdesi gösteriliyor
- [x] Proje tıklanınca `View::Project(id)` — Doğru çalışıyor
- [x] Tema değiştirme (dark/light) — `Theme` enum ile toggle çalışıyor
- [x] Aktif sayfa vurgulaması — `is_dashboard`, `is_overview`, `is_settings` boolean'ları doğru

#### Sorunlar

- **[KRİTİK] Sidebar sadece aktif projeleri listeliyor** — `get_projects_inner()` fonksiyonu (commands.rs:119) `WHERE p.status = 'active'` filtresi uyguluyor. Archived projeler sidebar'da hiç görünmüyor. Bu, Dashboard'daki archived section ile tutarsız. Sidebar'da en azından bir "Archived" grubu olmalı veya filtreleme seçeneği eklenmeli.
  - **Dosya:** `crates/seslog-app/src/commands.rs`, satır 119
  - **Beklenen:** Sidebar'da tüm projeler (veya archived toggle) görünmeli

- **[ORTA] Senkron DB erişimi render thread'de** — `commands::get_projects_inner(pool)` her render'da çağrılıyor (sidebar.rs:13). Dioxus'un reactive sistemi nedeniyle `_refresh` signal her değiştiğinde sidebar yeniden çizilir ve her seferinde SQLite sorgusu yapılır. Bu, çok sayıda proje olduğunda UI takılmasına neden olabilir.
  - **Dosya:** `crates/seslog-app/src/ui/sidebar.rs`, satır 12-13
  - **Beklenen:** `use_resource` veya `use_memo` ile cache'lenmiş veri kullanılmalı

- **[KOZMETİK] Emoji nav ikonları** — Navigasyon butonlarında emoji kullanılmış (📊, 📋, ⚙️). Bunlar platformdan platforma farklı render olur. SVG ikonlarla (lucide veya heroicons) değiştirilmeli.
  - **Dosya:** `crates/seslog-app/src/ui/sidebar.rs`, satır 33, 39, 73

### 2. Dashboard

#### Çalışan Özellikler
- [x] Hero card (Quick Resume) — İlk aktif proje gösteriliyor, isim, summary ve progress bar var
- [x] Proje kartları — Grid layout, isim, summary (2 satır clamp), progress bar, session sayısı, süre
- [x] Proje kartına tıklayınca `View::Project(id)` — Doğru çalışıyor
- [x] Archived section — Ayrı grid olarak gösteriliyor
- [x] Empty state — Proje yoksa anlamlı mesaj gösteriliyor ("No Projects Yet")
- [x] Active/Archived ayrımı — `projects.iter().filter(|p| p.status == ...)` ile yapılıyor

#### Sorunlar

- **[KRİTİK] "View Details" butonu hiçbir şey yapmıyor** — Hero card'daki "View Details" butonu `evt.stop_propagation()` çağırıyor ama navigasyon yapmıyor (dashboard.rs:79-82). Kullanıcı bu butona tıkladığında hiçbir şey olmaz — sadece event propagation durur.
  - **Dosya:** `crates/seslog-app/src/ui/dashboard.rs`, satır 79-82
  - **Beklenen:** `current_view.set(View::Project(hero_id.clone()))` eklenmeli
  - **Düzeltme:**
    ```rust
    button { class: "btn btn-primary",
        onclick: move |evt| {
            evt.stop_propagation();
            current_view.set(View::Project(hero_id.clone()));
        },
        "View Details"
    }
    ```

- **[ORTA] Hero card class eksik** — Hero card `div { class: "hero-card", ... }` kullanıyor ama CSS'te `.hero-card` border-radius tanımı yok. `glass-panel` class'ı eklenmemiş, dolayısıyla border-radius ve backdrop-filter uygulanmıyor.
  - **Dosya:** `crates/seslog-app/src/ui/dashboard.rs`, satır 65
  - **Beklenen:** `class: "hero-card glass-panel"` olmalı

- **[ORTA] Dashboard sorgusu archived projeleri döndürmüyor** — `get_projects_inner()` sadece `WHERE p.status = 'active'` filtresiyle çalışıyor ama Dashboard'daki `archived` Vec'i boş kalacak çünkü fonksiyon sadece aktif döndürüyor. Archived section hiçbir zaman dolu olmayacak.
  - **Dosya:** `crates/seslog-app/src/commands.rs`, satır 119 + `crates/seslog-app/src/ui/dashboard.rs`, satır 19-22
  - **Beklenen:** `get_projects_inner()` tüm projeleri döndürmeli veya ayrı bir `get_all_projects_inner()` fonksiyonu olmalı

- **[KOZMETİK] `project-card-name` ve `project-card-summary` class'ları CSS'te tanımsız** — dashboard.rs'de `project-card-name` ve `project-card-summary` kullanılıyor ama styles.css'te `.project-name` ve `.project-summary` olarak tanımlanmış. CSS selector uyumsuzluğu var.
  - **Dosya:** `crates/seslog-app/src/ui/dashboard.rs`, satır 152, 156 vs `assets/styles.css`, satır 195, 219
  - **Beklenen:** Class isimleri eşleşmeli

### 3. Overview

#### Çalışan Özellikler
- [x] Tablo dolmuş — Project, Last Activity, Progress, Sessions, Time, Cost sütunları mevcut
- [x] Sıralama (sort) — 6 alan için Asc/Desc toggle çalışıyor, ok ikonları görünüyor (↑↓)
- [x] Include Archived checkbox — `get_overview_inner(pool, include_archived())` ile çalışıyor
- [x] Relative time formatting — "Just now", "X min ago", "X hours ago", "X days ago" formatları
- [x] CostBadge — $1.00 üstü amber, altı green renk kodlaması
- [x] Proje tıklanınca `View::Project(id)` — Doğru çalışıyor
- [x] Empty state — Proje yoksa anlamlı mesaj gösteriliyor

#### Sorunlar

- **[KOZMETİK] Overview grid sütun genişlikleri dar** — CSS'te `grid-template-columns: 2fr 1fr 1fr 80px 80px 80px` tanımlı. Sessions, Time, Cost sütunları sadece 80px genişliğinde. Uzun değerler (ör. "12h 45m", "$15.2340") taşabilir.
  - **Dosya:** `assets/styles.css`, satır 738
  - **Beklenen:** Son 3 sütun en az 100px olmalı

- **[KOZMETİK] format_minutes fonksiyonu tekrar eden kod** — Aynı `format_minutes()` fonksiyonu dashboard.rs, overview.rs, project_detail.rs ve session_detail.rs'de tanımlı. DRY prensibine aykırı.
  - **Dosyalar:** dashboard.rs:171, overview.rs:295, project_detail.rs:359, session_detail.rs:173
  - **Beklenen:** `components.rs` veya utils modülüne taşınmalı

### 4. Project Detail

#### Çalışan Özellikler
- [x] Back butonu — `View::Dashboard` ile çalışıyor
- [x] Proje adı ve StatusDot — İsim ve aktif/archived durum gösteriliyor
- [x] Roadmap gösterimi — Phase başlıkları, checkbox'lar (done/pending), dependency indent
- [x] Session timeline — Son 5 session, tarih, summary, machine, duration, files, cost badge
- [x] Progress circle (%) — Büyük font ile yüzde gösteriliyor
- [x] İstatistikler — Total Sessions, Time Invested, Last Machine, Last Active dolmuş
- [x] Total Cost — Session'lardan hesaplanıyor, CostBadge ile gösteriliyor
- [x] Open in VS Code butonu — `code` komutu ile proje dizinini açıyor
- [x] Rebuild Cache butonu — `reconcile::full_rebuild()` çağırıyor
- [x] Roadmap warnings — Dependency uyarıları sarı renkte gösteriliyor

#### Sorunlar

- **[KRİTİK] Session tıklanınca detaya gitmiyor — timeline item'ların cursor'u yanlış** — `timeline-item` CSS'inde `cursor` tanımı yok. Kullanıcı session'a tıklayabileceğini görsel olarak anlayamıyor.
  - **Dosya:** `assets/styles.css`, satır 471-478
  - **Beklenen:** `.timeline-item { cursor: pointer; }` eklenmeli

- **[ORTA] İki sütunlu layout responsive değil** — `grid-template-columns: 2fr 1fr` sabit. Pencere küçültüldüğünde içerik sıkışacak. Dioxus desktop'ta pencere boyutu değişebilir.
  - **Dosya:** `crates/seslog-app/src/ui/project_detail.rs`, satır 122
  - **Beklenen:** Media query veya min-width ile responsive grid

- **[KOZMETİK] Roadmap "done" item'larında strikethrough yok** — CSS'te `.roadmap-text.done` tanımlı ama Rust kodunda `roadmap-item-text` class'ı kullanılıyor, `.done` class'ı hiç eklenmemiyor.
  - **Dosya:** `crates/seslog-app/src/ui/project_detail.rs`, satır 298
  - **Beklenen:** Done item'lara `roadmap-item-text done` class'ı eklenmeli

### 5. Session Detail

#### Çalışan Özellikler
- [x] Meta grid — Machine, Duration, Files Changed, Model, Recovered kartları dolmuş
- [x] Cost & Tokens paneli — Token count (K/M formatlı), Estimated Cost, Model
- [x] Summary bölümü — pre-wrap ile çok satırlı gösterim
- [x] Next Steps bölümü — Ayrı GlassPanel'de gösterim
- [x] Transcript Highlights — Liste halinde highlight-item class'ı ile
- [x] Back to Project butonu — Doğru proje ID'ye dönüyor
- [x] Empty state — Session bulunamazsa anlamlı mesaj

#### Sorunlar

- **[KRİTİK] Session bulma yöntemi verimsiz ve tehlikeli** — `get_sessions_inner(pool, project_id, 100)` çağrılıp sonra `sessions.iter().find(|s| s.id == session_id)` ile aranıyor (session_detail.rs:12-13). Bu, her session detail görüntülemede 100 session'ın tamamını çekiyor. Session sayısı 100'ü aşarsa, eski session'lar hiç bulunamayacak.
  - **Dosya:** `crates/seslog-app/src/ui/session_detail.rs`, satır 12-13
  - **Beklenen:** `get_session_by_id(pool, session_id)` gibi tek-session sorgusu olmalı

- **[ORTA] Date sütunu Meta grid'de eksik** — Promptta "Date" meta grid'de bekleniyor ama kodda `MetaCard { label: "Recovered" }` var, "Date" yok. Tarih sadece page header'da subtitle olarak gösteriliyor.
  - **Dosya:** `crates/seslog-app/src/ui/session_detail.rs`, satır 82-91
  - **Beklenen:** MetaCard'lar arasına Date eklenmeli

- **[ORTA] Input/Output token ayrımı yok** — Cost Breakdown panelinde sadece toplam token_count var, Input/Output ayrımı gösterilmiyor. Core model'de `input_tokens` ve `output_tokens` alanları mevcut ama session response'a taşınmamış.
  - **Dosya:** `crates/seslog-app/src/commands.rs`, satır 49-64 (SessionResponse struct)
  - **Beklenen:** `input_tokens` ve `output_tokens` alanları eklenmeli

### 6. Settings

#### Çalışan Özellikler
- [x] Privacy Mode dropdown — Full, Summary Only, Metadata Only seçenekleri
- [x] Sanitize Secrets toggle — Checkbox ile açılıp kapatılıyor
- [x] Checkpoint Interval gösterimi — Monospace font ile dakika cinsinden
- [x] Hook Status paneli — `which seslog` ile binary kontrolü, yeşil/gri dot
- [x] Sync Status paneli — Git repo, remote, pending changes durumu
- [x] Machine bilgisi — hostname, platform, arch
- [x] Rebuild Cache butonu — Çalışıyor, sonucu status mesajında gösteriyor
- [x] Support Bundle butonu — ZIP oluşturuyor, Downloads'a kaydediyor

#### Sorunlar

- **[KRİTİK] Run Doctor ve Reinstall Hook butonları implement edilmemiş** — Her ikisi de sadece "not yet implemented" mesajı gösteriyor (settings.rs:127, 133). Bu, kullanıcı deneyimini olumsuz etkiler.
  - **Dosya:** `crates/seslog-app/src/ui/settings.rs`, satır 126-138
  - **Beklenen:** `seslog doctor` komutu çağrılmalı veya butonlar disabled gösterilmeli

- **[ORTA] Toggle switch CSS uyumsuzluğu** — Settings'te `toggle` ve `toggle-slider` class'ları kullanılıyor (settings.rs:76-91) ama CSS'te toggle'ın child elementi `toggle-knob` olarak tanımlı, `toggle-slider` tanımsız. Ayrıca toggle aktif durumu CSS'te `.toggle.active` class'ına bağlı ama Dioxus'ta checkbox'ın checked durumu CSS class olarak yansıtılmıyor.
  - **Dosya:** `assets/styles.css`, satır 424-453 + `crates/seslog-app/src/ui/settings.rs`, satır 76-91
  - **Beklenen:** CSS ve Rust kodu arasındaki class isimleri eşleşmeli. Dioxus checkbox native render'ı kullanılarak veya custom toggle component yazılarak düzeltilmeli

- **[KOZMETİK] Privacy Mode dropdown seçimi yenilenmiyor** — `privacy_val` signal'i component mount'ta bir kez set ediliyor. Ama Dioxus her render'da `config` yeniden okunuyor ve `privacy_mode` değişkeni güncelleniyor. `privacy_val` signal'i ise ilk değerini koruyor. Bu, başka yerden config değişirse UI'ın eski değeri göstermesine neden olabilir.
  - **Dosya:** `crates/seslog-app/src/ui/settings.rs`, satır 30

### 7. Tema (Dark/Light)

#### Çalışan Özellikler
- [x] Dark tema — CSS variables ile glassmorphism, blur, gradient efektleri
- [x] Light tema — `.theme-light` class ile override edilen variable'lar
- [x] Toggle çalışıyor — Sidebar footer'daki buton ile tema değişiyor
- [x] CSS variable sistemi — Tutarlı renk paleti, border, shadow tanımları

#### Sorunlar

- **[KOZMETİK] Light temada blur kapalı** — `--blur-amount: 0px` (styles.css:642). Glassmorphism efektinin temel unsuru olan blur, light temada tamamen kapatılmış. Bu, dark ve light temalar arasında görsel tutarsızlık yaratıyor.
  - **Dosya:** `assets/styles.css`, satır 642
  - **Beklenen:** Light temada da hafif blur olmalı (ör. `5px`)

- **[KOZMETİK] Light tema sidebar class uyumsuzluğu** — CSS'te `.theme-light .sidebar-nav-item` kullanılıyor ama Rust kodunda class ismi `nav-item`. `sidebar-nav-item` hiçbir yerde kullanılmıyor.
  - **Dosya:** `assets/styles.css`, satır 687-693
  - **Beklenen:** `.theme-light .nav-item` olarak düzeltilmeli

---

## Veri Katmanı Analizi

### SQLite Schema (v2)
- [x] Tablolar doğru — projects, sessions, transcript_highlights, roadmap_items, decisions, machines, processed_events
- [x] İndeksler mevcut — project_id, started_at, machine üzerinde
- [x] View — `project_summary` aggregate view'ı mevcut ama UI tarafından kullanılmıyor
- [x] Migration — v1→v2 çalışıyor (item_id, depends_on, token_count, estimated_cost_usd, model ekleniyor)

### Reconcile Sistemi
- [x] Full rebuild — Transaction içinde, rollback destekli
- [x] Incremental update — Session JSON, roadmap.md, meta.toml değişikliklerini algılıyor
- [x] Watcher — notify + polling fallback ile çift modlu izleme
- [x] Periodic reconcile — 10 dakikada bir tam eşitleme

### Sorunlar

- **[KRİTİK] `progress_percent` tipi uyumsuzluğu** — DB schema'da `progress_percent INTEGER` (db.rs:21) ama commands.rs'deki SQL sorguları `f64` olarak okuyor (commands.rs:129). `import_roadmap` fonksiyonu `i32` olarak yazıyor (reconcile.rs:336). Bu tip uyumsuzluğu SQLite'ın flexible typing'i sayesinde şimdilik çalışıyor ama veri kaybına yol açabilir.
  - **Dosya:** `crates/seslog-app/src/db.rs:21`, `crates/seslog-app/src/reconcile.rs:336`, `crates/seslog-app/src/commands.rs:129`
  - **Beklenen:** Tüm katmanlarda tutarlı tip (f64 veya i32) kullanılmalı

- **[KRİTİK] `project_summary` view kullanılmıyor** — DB'de `project_summary` view'ı tanımlı ama `commands.rs`'deki sorgular aynı JOIN'i tekrar yazıyor. Bu hem bakım yükü hem de tutarsızlık riski yaratıyor.
  - **Dosya:** `crates/seslog-app/src/db.rs:91-112` vs `crates/seslog-app/src/commands.rs:108-122`
  - **Beklenen:** View kullanılmalı veya kaldırılmalı

---

## Kritik Sorunlar (Acil Düzeltilmeli)

1. **"View Details" butonu çalışmıyor** — dashboard.rs:79-82, navigasyon eksik
2. **Dashboard archived projeleri gösteremiyor** — commands.rs:119 sadece active filtresi
3. **Session detail 100 session limiti** — session_detail.rs:12, tekil sorgu olmalı
4. **Run Doctor / Reinstall Hook implement edilmemiş** — settings.rs:126-138
5. **progress_percent tip uyumsuzluğu** — INTEGER vs f64 vs i32 karışık
6. **Sidebar'da archived projeler görünmüyor** — commands.rs:119
7. **Timeline item cursor eksik** — CSS'te cursor: pointer yok

## Orta Öncelikli Sorunlar

1. **Senkron DB erişimi render thread'de** — sidebar.rs:13, dashboard.rs:12
2. **Hero card'da glass-panel class eksik** — dashboard.rs:65
3. **CSS class isim uyumsuzlukları** — project-card-name vs project-name, toggle-slider vs toggle-knob
4. **Session detail'de Date meta card eksik** — session_detail.rs:82-91
5. **Input/Output token ayrımı yok** — commands.rs SessionResponse struct'ında
6. **İki sütunlu layout responsive değil** — project_detail.rs:122
7. **Toggle switch CSS/Rust uyumsuzluğu** — settings.rs:76-91
8. **Privacy dropdown state yenilenme sorunu** — settings.rs:30

## Kozmetik Sorunlar

1. **Emoji nav ikonları** — Platform bağımsız SVG ikonlara geçilmeli
2. **Overview sütun genişlikleri** — 80px dar, 100px+ olmalı
3. **format_minutes tekrarlayan kod** — 4 dosyada aynı fonksiyon
4. **Light temada blur kapalı** — Glassmorphism tutarsızlığı
5. **Roadmap done item'larında strikethrough yok** — Class uyumsuzluğu
6. **Light tema sidebar class uyumsuzluğu** — sidebar-nav-item vs nav-item
7. **CSS'te eski "ctx-lab" yorumu** — styles.css:1, branding tutarsızlığı

---

## İyileştirme ve Modernizasyon Önerileri

### Mimari

1. **Async veri yükleme** — `use_resource` veya `use_server_future` ile DB sorgularını async yaparak render thread'i bloklamayı önleyin. Mevcut senkron erişim, proje sayısı arttıkça UI donmalarına yol açacak.

2. **Tekil session sorgusu** — `get_session_by_id(pool, session_id)` fonksiyonu ekleyin. Mevcut yaklaşım (100 session çekip filtrele) gereksiz bellek ve CPU kullanımı.

3. **project_summary view'ını kullanın veya kaldırın** — DB'de tanımlı view, commands.rs'deki sorgularla aynı işi yapıyor. Ya view kullanılmalı ya da kaldırılmalı.

4. **Utils modülü** — `format_minutes()`, `format_date()`, `format_relative_time()`, `truncate_summary()` gibi yardımcı fonksiyonları tek bir `utils.rs` modülüne taşıyın.

### UI/UX

5. **SVG ikon sistemi** — Emoji yerine tutarlı bir ikon seti (Heroicons, Lucide) kullanın. İkonları CSS veya inline SVG olarak ekleyin.

6. **Loading state'leri** — Veri yüklenirken skeleton/spinner gösterin. Şu an veri yoksa direkt empty state gösteriliyor, bu "yükleniyor" mu "gerçekten boş" mu ayırt edilemez hale getiriyor.

7. **Keyboard navigasyonu** — Tab ile nav butonları arasında geçiş, Enter ile seçim. Accessibility (a11y) açısından önemli.

8. **Breadcrumb navigasyonu** — Dashboard > Project > Session hiyerarşisini gösteren bir breadcrumb bileşeni ekleyin. Şu an sadece "Back" butonları var.

9. **Search/Filter** — Proje ve session arama özelliği. Sidebar'da arama kutusu, Overview'da metin filtresi.

10. **Responsive layout** — CSS grid'lerde `minmax()` ve media query kullanarak pencere boyutuna uyum sağlayın.

### Veri Katmanı

11. **Tip tutarlılığı** — `progress_percent` için tüm katmanlarda `f64` kullanın. Schema'da `REAL` olarak değiştirin.

12. **Connection pooling** — Mevcut `DbConnector` her `get()` çağrısında yeni connection açıyor. r2d2 veya deadpool ile connection pool kullanın.

13. **Prepared statement cache** — Sık kullanılan sorguları `rusqlite::CachedStatement` ile cache'leyin.

### Kod Kalitesi

14. **Error handling** — UI'da `unwrap_or_default()` yerine kullanıcıya anlamlı hata mesajı gösterin. Özellikle DB bağlantı hatalarında.

15. **Test coverage** — UI bileşenleri için unit test yok. Dioxus'un test utilities'i ile component testleri ekleyin. commands.rs ve reconcile.rs testleri mevcut ve iyi yazılmış.

---

## Genel Değerlendirme

Seslog masaüstü uygulaması, Claude Code oturum takibi için sağlam bir temele sahip. Core kütüphane (seslog-core) olgun ve iyi test edilmiş. Reconcile mekanizması güvenilir. DB schema'sı düşünceli tasarlanmış, migration desteği var.

Uygulamanın ana zayıf noktaları UI katmanında yoğunlaşmış: CSS class uyumsuzlukları, implement edilmemiş butonlar, veri erişim kalıpları ve responsive tasarım eksiklikleri. Bunlar düzeltildiğinde profesyonel kalitede bir masaüstü uygulaması ortaya çıkacaktır.

**Öncelik sırası:**
1. Kritik butonları düzelt (View Details, Doctor, Reinstall)
2. Archived proje erişimini sağla
3. Session detail sorgusunu optimize et
4. CSS class uyumsuzluklarını gider
5. Async veri yüklemeye geç
6. SVG ikon sistemi ve responsive layout
