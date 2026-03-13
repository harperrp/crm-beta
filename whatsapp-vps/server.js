const express = require("express");
const cors = require("cors");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const WEBHOOK_URL = "https://uhumbtpkioisepqiqotl.supabase.co/functions/v1/whatsapp-webhook-baileys";
const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let qrCodeDataURL = null;
let connectionStatus = "starting";
let reconnectTimeout = null;

function normalizeNumber(number) {
  return String(number || "").replace(/\D/g, "");
}

function toJid(number) {
  return `${normalizeNumber(number)}@s.whatsapp.net`;
}

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    sock = makeWASocket({
      auth: state,
      browser: ["Ubuntu", "Chrome", "20.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
    });

    sock.ev.on("creds.update", saveCreds);
sock.ev.on("messages.upsert", async ({ messages, type }) => {
  try {
    if (!messages || !messages.length) return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key?.fromMe) continue;

      const remoteJid = msg.key?.remoteJid || "";
      const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");

      let text = "";

      if (msg.message?.conversation) {
        text = msg.message.conversation;
      } else if (msg.message?.extendedTextMessage?.text) {
        text = msg.message.extendedTextMessage.text;
      }

      const payload = {
        provider: "baileys",
        event: "messages.upsert",
        instance_id: "default",
        data: {
          phone,
          text,
          message: msg.message
        }
      };

      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
  "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVodW1idHBraW9pc2VwcWlxb3RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDc2ODMsImV4cCI6MjA4NzQ4MzY4M30.zrh-0co_dhQTFg55Ou2V9pF1udV_XvQTthqHrj1fafI"
        },
        body: JSON.stringify(payload)
      });

      console.log("WEBHOOK ENVIADO:", response.status);
    }

  } catch (error) {
    console.error("ERRO WEBHOOK:", error);
  }
});
    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        qrCodeDataURL = await QRCode.toDataURL(qr);
        connectionStatus = "qr_ready";
        console.log("QR CODE GERADO");
      }

      if (connection === "open") {
        connectionStatus = "connected";
        qrCodeDataURL = null;
        console.log("WHATSAPP CONECTADO");
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log("CONEXAO FECHADA:", statusCode);

        qrCodeDataURL = null;
        connectionStatus = "disconnected";

        if (statusCode !== DisconnectReason.loggedOut) {
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            console.log("TENTANDO RECONECTAR...");
            startWhatsApp();
          }, 5000);
        } else {
          console.log("SESSAO ENCERRADA");
        }
      }
    });
  } catch (error) {
    console.error("ERRO AO INICIAR WHATSAPP:", error);
    connectionStatus = "error";
  }
}

app.get("/status", (req, res) => {
  res.json({
    status: connectionStatus,
    connected: connectionStatus === "connected",
    qrAvailable: !!qrCodeDataURL,
  });
});

app.get("/qr", (req, res) => {
  res.json({
    status: connectionStatus,
    qrCode: qrCodeDataURL,
    qrAvailable: !!qrCodeDataURL,
  });
});

app.post("/send-message", async (req, res) => {
  try {
    if (!sock || connectionStatus !== "connected") {
      return res.status(400).json({
        success: false,
        error: "WhatsApp não está conectado",
      });
    }

    const { number, text } = req.body || {};

    if (!number || !text) {
      return res.status(400).json({
        success: false,
        error: "number e text são obrigatórios",
      });
    }

    const result = await sock.sendMessage(toJid(number), { text });

    return res.json({
      success: true,
      messageId: result?.key?.id || null,
    });
  } catch (error) {
    console.error("ERRO AO ENVIAR:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro ao enviar mensagem",
    });
  }
});

app.post("/logout", async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }

    qrCodeDataURL = null;
    connectionStatus = "disconnected";

    return res.json({ success: true });
  } catch (error) {
    console.error("ERRO AO DESCONECTAR:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro ao desconectar",
    });
  }
});

app.get("/", (req, res) => {
  res.send("WhatsApp server online");
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`SERVIDOR RODANDO NA PORTA ${PORT}`);
  startWhatsApp();
});
