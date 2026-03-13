const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_AUTH_TOKEN = process.env.WEBHOOK_AUTH_TOKEN;
const WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET;
const VPS_INTERNAL_API_KEY = process.env.VPS_INTERNAL_API_KEY;
const PORT = Number(process.env.PORT || 3000);

function validateRequiredEnv() {
  const missing = [];

  if (!WEBHOOK_URL) missing.push("WEBHOOK_URL");
  if (!VPS_INTERNAL_API_KEY) missing.push("VPS_INTERNAL_API_KEY");
  if (!WEBHOOK_AUTH_TOKEN && !WEBHOOK_HMAC_SECRET) {
    missing.push("WEBHOOK_AUTH_TOKEN ou WEBHOOK_HMAC_SECRET");
  }

  if (missing.length > 0) {
    const details = missing.join(", ");
    throw new Error(`Variáveis obrigatórias ausentes: ${details}`);
  }
}

function authMiddleware(req, res, next) {
  const apiKey = req.header("x-api-key") || req.header("authorization")?.replace(/^Bearer\s+/i, "");

  if (!apiKey || apiKey !== VPS_INTERNAL_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Não autorizado: API key inválida ou ausente",
    });
  }

  return next();
}

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let qrCodeDataURL = null;
let connectionStatus = "starting";
let reconnectTimeout = null;
let lastQrAt = null;

function normalizeNumber(number) {
  return String(number || "").replace(/\D/g, "");
}

function toJid(number) {
  return `${normalizeNumber(number)}@s.whatsapp.net`;
}

function buildWebhookHeaders(payload) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (WEBHOOK_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${WEBHOOK_AUTH_TOKEN}`;
  }

  if (WEBHOOK_HMAC_SECRET) {
    const signature = crypto
      .createHmac("sha256", WEBHOOK_HMAC_SECRET)
      .update(payload)
      .digest("hex");
    headers["x-webhook-signature-256"] = `sha256=${signature}`;
  }

  return headers;
}

function getInstanceStatusPayload() {
  return {
    status: connectionStatus,
    connected: connectionStatus === "connected",
    qrAvailable: !!qrCodeDataURL,
    lastQrAt,
  };
}

function getInstanceQrPayload() {
  return {
    status: connectionStatus,
    qrCode: qrCodeDataURL,
    qrAvailable: !!qrCodeDataURL,
    lastQrAt,
  };
}

function renderQrHtml() {
  return `
    <html>
      <head>
        <title>WhatsApp QR</title>
        <meta http-equiv="refresh" content="5" />
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 30px;
          }
          img {
            max-width: 320px;
            border: 1px solid #ddd;
            padding: 12px;
            border-radius: 12px;
          }
        </style>
      </head>
      <body>
        <h2>Escaneie o QR do WhatsApp</h2>
        <img src="${qrCodeDataURL}" alt="QR Code" />
        <p>Status: ${connectionStatus}</p>
        <p>Gerado em: ${lastQrAt || "-"}</p>
      </body>
    </html>
  `;
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

    sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        if (!messages?.length) return;

        for (const msg of messages) {
          if (!msg.message) continue;
          if (msg.key?.fromMe) continue;

          const remoteJid = msg.key?.remoteJid || "";
          const phone = remoteJid
            .replace("@s.whatsapp.net", "")
            .replace("@g.us", "");

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
              message: msg.message,
            },
          };

          const body = JSON.stringify(payload);
          const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: buildWebhookHeaders(body),
            body,
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
        try {
          qrCodeDataURL = await QRCode.toDataURL(qr);
          lastQrAt = new Date().toISOString();
          connectionStatus = "qr_ready";
          console.log("QR CODE GERADO");
        } catch (err) {
          console.error("ERRO AO CONVERTER QR:", err);
        }
      }

      if (connection === "open") {
        connectionStatus = "connected";
        qrCodeDataURL = null;
        lastQrAt = null;
        console.log("WHATSAPP CONECTADO");
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log("CONEXAO FECHADA:", statusCode);

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

      console.log("STATUS ATUAL:", {
        connectionStatus,
        qrAvailable: !!qrCodeDataURL,
        lastQrAt,
      });
    });
  } catch (error) {
    console.error("ERRO AO INICIAR WHATSAPP:", error);
    connectionStatus = "error";
  }
}

app.get("/status", authMiddleware, (req, res) => {
  res.json(getInstanceStatusPayload());
});

app.get("/qr", authMiddleware, (req, res) => {
  res.json(getInstanceQrPayload());
});

app.get("/qr-image", authMiddleware, (req, res) => {
  if (!qrCodeDataURL) {
    return res
      .status(404)
      .send("<h1>QR ainda não disponível. Atualize em alguns segundos.</h1>");
  }

  return res.send(renderQrHtml());
});

app.get("/instance/status", authMiddleware, (req, res) => {
  res.json(getInstanceStatusPayload());
});

app.get("/instance/qr", authMiddleware, (req, res) => {
  res.json(getInstanceQrPayload());
});

app.get("/instance/qr-image", authMiddleware, (req, res) => {
  if (!qrCodeDataURL) {
    return res
      .status(404)
      .send("<h1>QR ainda não disponível. Atualize em alguns segundos.</h1>");
  }

  return res.send(renderQrHtml());
});

app.post("/send-message", authMiddleware, async (req, res) => {
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

app.post("/logout", authMiddleware, async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }

    qrCodeDataURL = null;
    lastQrAt = null;
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

app.post("/instance/logout", authMiddleware, async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }

    qrCodeDataURL = null;
    lastQrAt = null;
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

try {
  validateRequiredEnv();
} catch (error) {
  console.error("ERRO DE CONFIGURAÇÃO:", error.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`SERVIDOR RODANDO NA PORTA ${PORT}`);
  startWhatsApp();
});
