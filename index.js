const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');

// --- CONFIGURAÇÕES ---
const app = express();
const port = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Variáveis Globais (Estado)
let sorteio = {
    ativo: false,
    participantes: [],
    chatId: null // Onde o sorteio está rolando
};

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- 1. SITE (INTERFACE VISUAL) ---
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Super Bot Zap</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #e5ddd5; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
            .header { background: #075e54; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .card { background: #f9f9f9; border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 8px; }
            h3 { margin-top: 0; color: #128c7e; }
            input, textarea { width: 100%; padding: 10px; margin: 5px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
            button { width: 100%; padding: 12px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; margin-top: 5px; }
            .btn-green { background: #25d366; color: white; }
            .btn-blue { background: #34b7f1; color: white; }
            .btn-red { background: #d32f2f; color: white; }
            .status { font-size: 0.9em; color: #666; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
            <div class="header"><h1>🤖 Painel de Controle</h1></div>
            <div class="content">
                
                <div class="card">
                    <h3>📨 Enviar Mensagem</h3>
                    <form action="/api/enviar" method="POST">
                        <input type="text" name="numero" placeholder="Ex: 5511999998888 ou ID do Grupo" required>
                        <textarea name="mensagem" rows="3" placeholder="Sua mensagem..." required></textarea>
                        <button type="submit" class="btn-green">Enviar Agora</button>
                    </form>
                </div>

                <div class="card">
                    <h3>🎉 Controle do Sorteio</h3>
                    <p class="status">Status: <strong>${sorteio.ativo ? 'ATIVO (Pessoas podem digitar /entrar)' : 'PARADO'}</strong></p>
                    <p class="status">Participantes: ${sorteio.participantes.length}</p>
                    
                    <form action="/api/sorteio/iniciar" method="POST">
                        <input type="text" name="chatId" placeholder="ID do Chat ou nº para iniciar" required>
                        <button type="submit" class="btn-blue">Iniciar Sorteio Aqui</button>
                    </form>
                    <br>
                    <form action="/api/sorteio/sortear" method="POST">
                         <button type="submit" class="btn-green">Sortear Vencedor</button>
                    </form>
                    <br>
                    <form action="/api/sorteio/parar" method="POST">
                         <button type="submit" class="btn-red">Cancelar Sorteio</button>
                    </form>
                </div>

                <div class="card">
                    <h3>🎲 Outros</h3>
                    <p>Para descobrir o ID de um grupo, digite <b>/id</b> no WhatsApp.</p>
                </div>

            </div>
        </div>
      </body>
    </html>
  `);
});

// --- LÓGICA DO BOT ---
if (!MONGO_URI) { console.error("Sem MONGO_URI"); } 
else {
    mongoose.connect(MONGO_URI).then(() => {
        const store = new MongoStore({ mongoose: mongoose });
        const client = new Client({
            authStrategy: new RemoteAuth({ store: store, backupSyncIntervalMs: 60000 }),
            puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true }
        });

        // --- API DO SITE (RECEBE OS CLIQUES DOS BOTÕES) ---
        
        // 1. Enviar msg
        app.post('/api/enviar', async (req, res) => {
            let { numero, mensagem } = req.body;
            if (!numero.includes('@')) numero = `${numero}@c.us`; // Formata se for número simples
            await client.sendMessage(numero, mensagem);
            res.redirect('/');
        });

        // 2. Iniciar Sorteio (Pelo site)
        app.post('/api/sorteio/iniciar', async (req, res) => {
            let { chatId } = req.body;
            if (!chatId.includes('@')) chatId = `${chatId}@c.us`;
            
            if (sorteio.ativo) return res.send('<h1>Já tem sorteio rolando!</h1><a href="/">Voltar</a>');
            
            sorteio.ativo = true;
            sorteio.participantes = [];
            sorteio.chatId = chatId;

            await client.sendMessage(chatId, '🎉 *SORTEIO INICIADO PELO SITE!* 🎉\n\nDigite */entrar* para participar!');
            res.redirect('/');
        });

        // 3. Sortear (Pelo site)
        app.post('/api/sorteio/sortear', async (req, res) => {
            if (!sorteio.ativo || sorteio.participantes.length === 0) return res.redirect('/');
            
            const vencedor = sorteio.participantes[Math.floor(Math.random() * sorteio.participantes.length)];
            await client.sendMessage(sorteio.chatId, `🏆 *O VENCEDOR É:* @${vencedor.user}`, {
                mentions: [vencedor]
            });
            
            sorteio.ativo = false;
            sorteio.participantes = [];
            res.redirect('/');
        });

        // 4. Cancelar
        app.post('/api/sorteio/parar', async (req, res) => {
            sorteio.ativo = false;
            sorteio.participantes = [];
            res.redirect('/');
        });


        // --- COMANDOS DO WHATSAPP ---
        client.on('message', async (msg) => {
            const chat = await msg.getChat();
            const texto = msg.body.toLowerCase(); // Facilita comparação

            // --- COMANDO 1: FIGURINHA (/sticker) ---
            if (texto === '/sticker' || texto === '/figurinha') {
                if (msg.hasMedia) {
                    const media = await msg.downloadMedia();
                    client.sendMessage(msg.from, media, { sendMediaAsSticker: true });
                } 
                else if (msg.hasQuotedMsg) {
                    // Se respondeu a uma imagem
                    const quotedMsg = await msg.getQuotedMessage();
                    if (quotedMsg.hasMedia) {
                        const media = await quotedMsg.downloadMedia();
                        client.sendMessage(msg.from, media, { sendMediaAsSticker: true });
                    } else {
                        msg.reply('❌ A mensagem respondida não tem imagem!');
                    }
                } else {
                    msg.reply('❌ Mande uma imagem com a legenda /sticker ou responda a uma imagem.');
                }
            }

            // --- COMANDO 2: DADO (/dado) ---
            if (texto === '/dado') {
                const resultado = Math.floor(Math.random() * 6) + 1;
                msg.reply(`🎲 Você rolou: *${resultado}*`);
            }

            // --- COMANDO 3: DESCOBRIR ID (/id) ---
            if (texto === '/id') {
                // Útil para pegar o ID do grupo e usar no site
                msg.reply(`🆔 O ID deste chat é:\n\`${msg.from}\``);
            }

            // --- COMANDO 4: SORTEIO (Lógica compartilhada com o site) ---
            if (texto === '/sorteio') {
                if (sorteio.ativo) return msg.reply('⚠️ Já tem um sorteio rolando!');
                sorteio.ativo = true;
                sorteio.participantes = [];
                sorteio.chatId = msg.from;
                await client.sendMessage(msg.from, '🎉 *SORTEIO INICIADO!* 🎉\nDigite */entrar* para participar.\nAdmin: use */ganhador* ou controle pelo site.');
            }

            if (texto === '/entrar' && sorteio.ativo && msg.from === sorteio.chatId) {
                const contato = await msg.getContact();
                const jaParticipa = sorteio.participantes.find(p => p.id._serialized === contato.id._serialized);
                
                if (jaParticipa) {
                    msg.reply('Você já está dentro! 🤨');
                } else {
                    sorteio.participantes.push(contato.id);
                    msg.reply('✅ Você entrou no sorteio!');
                }
            }

            if (texto === '/ganhador' && sorteio.ativo && msg.from === sorteio.chatId) {
                if (sorteio.participantes.length === 0) return msg.reply('Ninguém entrou... 😢');
                
                const vencedor = sorteio.participantes[Math.floor(Math.random() * sorteio.participantes.length)];
                
                await chat.sendMessage(`🎊 O VENCEDOR É: @${vencedor.user} 🎊`, {
                    mentions: [vencedor]
                });
                
                sorteio.ativo = false;
                sorteio.participantes = [];
            }

            // --- COMANDO 5: AJUDA ---
            if (texto === '/ajuda' || texto === '/menu') {
                msg.reply(`🤖 *MENU DO BOT*\n\n📸 */sticker* - Cria figurinha\n🎲 */dado* - Rola um dado\n🆔 */id* - Vê o ID do chat\n🎉 */sorteio* - Inicia sorteio\n🎟️ */entrar* - Entra no sorteio\n🏆 */ganhador* - Encerra sorteio\n\n_Controle também pelo site!_`);
            }
        });

        client.on('ready', () => { console.log('✅ Bot Online e Pronto!'); });
        client.initialize();
    });
}

app.listen(port, () => { console.log(`Site rodando na porta ${port}`); });
