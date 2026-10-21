# Agenda Livre

Sistema de agendamento **open source** para barbearias, salões, estúdios e clínicas.
Seus clientes marcam horário pelo celular, pagam o sinal via **PIX** e recebem lembrete no **WhatsApp**.
Sem mensalidade: você instala no seu próprio servidor.

<!-- Cole aqui o botão "Implantar na Hostinger" gerado no programa Para devs -->

## Funcionalidades

- Página pública de agendamento, pensada para celular
- Vários serviços (duração e preço) e vários profissionais
- Horário de funcionamento por dia da semana, com pausas (ex.: almoço)
- Sinal via PIX com QR Code e "copia e cola" gerados automaticamente
- Cliente consulta e cancela o próprio horário pelo link recebido
- Painel com agenda do dia, faturamento previsto e botão de lembrete no WhatsApp
- Lembretes automáticos opcionais pela [Evolution API](https://github.com/EvolutionAPI/evolution-api)
- Um único container, banco SQLite embutido, sem dependências externas

## Instalação

### Docker (recomendado)

```bash
git clone https://github.com/kaueksilva/agenda-livre.git
cd agenda-livre
cp .env.example .env   # opcional: defina ADMIN_PASSWORD
docker compose up -d
```

Acesse `http://SEU-SERVIDOR:3000/admin` para configurar o negócio.
A página que você manda para os clientes é `http://SEU-SERVIDOR:3000/`.

### Node.js

Requer Node.js 22.13 ou superior.

```bash
npm install
npm start
```

Os dados ficam em `./data/agenda.db` (ou no caminho de `DATA_DIR`). Para fazer backup, copie esse arquivo.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `TZ` | `America/Sao_Paulo` | Fuso horário do negócio |
| `DATA_DIR` | `./data` | Pasta do banco SQLite |
| `ADMIN_PASSWORD` | — | Senha inicial do painel. Recomendado em servidores públicos, para ninguém fazer o setup antes de você |
| `EVOLUTION_API_URL` | — | URL da sua Evolution API |
| `EVOLUTION_API_KEY` | — | API key da Evolution API |
| `EVOLUTION_INSTANCE` | — | Nome da instância conectada ao WhatsApp |
| `REMINDER_HOURS_BEFORE` | `24` | Com quantas horas de antecedência o lembrete é enviado |

Com a Evolution API configurada, o dono recebe um aviso a cada novo agendamento e os clientes recebem lembrete automático.
Sem ela, o painel mostra um botão que abre o WhatsApp com a mensagem pronta.

## Roadmap

- [ ] Bloqueio de datas (feriados, férias)
- [ ] Horários diferentes por profissional
- [ ] Confirmação automática do PIX (Mercado Pago / Efí)
- [ ] Relatórios mensais
- [ ] Personalização de cores e logo

Contribuições são bem-vindas!

## Licença

[MIT](LICENSE)
