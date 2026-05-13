# ctx-lab

ctx-lab, Claude Code ve Codex gibi AI araçlarıyla çalışırken insan bağlamının kopmasını azaltmak için tasarlanan GitHub-backed çalışma hafızası uygulamasıdır.

## Ana fikir

AI sohbet geçmişine güvenmek yerine, her önemli oturumdan sonra kısa ve insan-onaylı bir özet özel bir GitHub memory repo'ya yazılır. ctx-lab bu repo'yu okuyarak:

- AI Inbox'ta yeni oturum özetlerini toplar,
- iş panosunda aktif işleri gösterir,
- karar defterini kaynaklı tutar,
- Codex veya Claude için devam prompt'u üretir.

Uygulama v1'de tamamen Türkçe arayüzle gelir. Veri alanları teknik sebeplerle İngilizce kalabilir, ancak kullanıcıya görünen metinler Türkçedir.

## Hızlı başlatma

```bash
npm install
npm run dev
```

Sonra tarayıcıda Vite'ın verdiği yerel adresi açın.

## GitHub token

Private memory repo için fine-grained GitHub token önerilir:

- Repository access: sadece memory repo
- Permissions: Contents read/write

Token yalnızca tarayıcı localStorage alanında saklanır. Sunucu tarafı yoktur.

## Memory repo yapısı

```text
work-memory/
  inbox/
  work_items/
  decisions/
  handoffs/
  archive/
  config.yaml
```

Detaylı format için [docs/memory-format.md](docs/memory-format.md) dosyasına bakın.
