# Hermes Grupo Erick

Assistente de gestão do Grupo Erick (varejo de calçados e roupas em
Barreiros-PE e Sirinhaém-PE).

## Onde está cada parte

| Parte | Pasta | Situação |
| --- | --- | --- |
| Bot Telegram privado e API de leitura | `platform/` | Em uso (VPS, modo staging). Ver `platform/README.md` |
| Módulos de domínio (templates SQL, finanças, contabilidade, jurídico, inteligência) | `src/hermes/` | Testados em `test/`; os templates SQL são a base das próximas consultas do bot |
| Marketing (contratos e simulações) | `marketing/` | Somente simulação |
| Auditoria de uso diário | `docs/HERMES_AUDITORIA_USO_DIARIO_2026-11-24.md` | Estado atual e plano |

O chat web v1 (`server.js` + `public/`, publicado no Railway) foi
**aposentado em 2026-11**: não estava mais no ar e carregava riscos que
voltariam se fosse republicado. O código continua no histórico do git.

## Testes

```bash
npm ci
npm test                       # suíte da raiz (inclui platform/)
cd platform/services/api && npm ci && npm test   # suíte da plataforma
```

## Validar os SQL Templates contra o banco

```bash
cp .env.example .env           # preencha DATABASE_URL (papel somente leitura)
npm run validate:templates
```
