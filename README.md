# ctx-lab

ctx-lab, Claude Code ve Codex gibi AI araçlarıyla çalışırken insan bağlamının kopmasını azaltmak için tasarlanan GitHub-backed çalışma hafızası uygulamasıdır.

## Ana fikir

AI sohbet geçmişine güvenmek yerine, her önemli oturumdan sonra kısa ve insan-onaylı bir özet özel bir GitHub memory repo'ya yazılır. ctx-lab bu repo'yu okuyarak:

- AI Inbox'ta yeni oturum özetlerini toplar,
- iş panosunda aktif işleri gösterir,
- aynı proje için gelen yeni oturumları mevcut iş kartına bağlar,
- karar defterini kaynaklı tutar,
- Codex veya Claude için devam prompt'u üretir.

Uygulama v1'de tamamen Türkçe arayüzle gelir. Veri alanları teknik sebeplerle İngilizce kalabilir, ancak kullanıcıya görünen metinler Türkçedir.

## Hızlı başlatma

```bash
npm install
npm run dev
```

Sonra tarayıcıda Vite'ın verdiği yerel adresi açın. Bu geliştirme ortamında varsayılan adres `http://127.0.0.1:5173`.

## GitHub memory repo kurulumu

Private memory repo için fine-grained GitHub token önerilir:

- Repository access: sadece memory repo
- Permissions: Contents read/write

Uygulamada `Repo Bağlantısı` ekranından owner/repo, branch ve token girilir. `Repo Yapısını Hazırla` düğmesi şu yapıyı otomatik oluşturur:

```text
work-memory/
  inbox/
  work_items/
  decisions/
  handoffs/
  archive/
  config.yaml
```

Token yalnızca tarayıcı localStorage alanında saklanır. Sunucu tarafı yoktur.

## Manuel oturum özeti akışı

`Yeni Özet` ekranı, Codex veya Claude oturumundan sonra temiz bir kayıt üretir. Kayıt `inbox/` altına timestamp içeren benzersiz dosya adıyla yazılır. AI Inbox'tan `İş Kartına Bağla` seçildiğinde aynı proje için var olan iş kartı varsa yeni session id o karta eklenir; yoksa yeni kart oluşturulur.

Detaylı format için [docs/memory-format.md](docs/memory-format.md) dosyasına bakın.
