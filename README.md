# Assistente Grupo Erick

Chat de gestão com IA para consulta de dados das lojas do Grupo Erick.

## Stack
- Node.js + Express (backend)
- Claude API claude-sonnet-4-6 com tool use (agente)
- Supabase PostgreSQL (banco de dados)
- HTML/CSS/JS puro (frontend)

## Deploy no Railway

### 1. Crie um novo serviço
- New Project → Deploy from GitHub repo
- Selecione este repositório

### 2. Configure as variáveis de ambiente
No painel do Railway, vá em Variables e adicione:

```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://postgres.yxmdrrwqxwzsdgcgskrm:SENHA@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

### 3. Deploy automático
O Railway vai detectar o package.json e rodar `npm start` automaticamente.

### 4. Gere a URL pública
Settings → Networking → Generate Domain

## Desenvolvimento local

```bash
npm install
cp .env.example .env
# Preencha o .env com suas credenciais
npm start
# Acesse http://localhost:3001
```

## Estrutura
```
├── server.js          # Backend Node.js + agente Claude
├── public/
│   └── index.html     # Interface do chat
├── package.json
├── .env.example
└── README.md
```
