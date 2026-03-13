const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
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
  const apiKey =
    req.header("x-api-key") ||
    req.header("authorization")?.replace(/^Bearer\s+/i, "");

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

const SESSIONS_ROOT = path.resolve(__dirname, "sessions");
const instanceRegistry = new Map();

function normalizeNumber(number) {
  return String(number || "").replace(/\D/g, "");
}

function toJid(number) {
  return `${normalizeNumber(number)}@s.whatsapp.net`;
}

function sanitizeInstanceId(instanceId) {
  return String(instanceId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function ensureSessionsRoot() {
  fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
}

function getSessionPath(instanceId) {
  ensureSessionsRoot();
  const safeId = sanitizeInstanceId(instanceId);

  if (!safeId) {
    throw new Error("instanceId inválido");
  }

  return path.join(SESSIONS_ROOT, safeId);
}

function getInstanceState(instanceId) {
  const safeId = sanitizeInstanceId(instanceId);

  if (!safeId) {
    throw new Error("instanceId inválido");
  }

  if (!instanceRegistry.has(safeId)) {
    instanceRegistry.set(safeId, {
      instanceId: safeId,
      sock: null,
      qrCodeDataURL: null,
      connectionStatus: "disconnected",
      reconnectTimeout: null,
      lastQrAt: null,
      isStarting: false,
    });
  }

  return instanceRegistry.get(safeId);
}

function buildStatus(state) {
  return {
    instanceId: state.instanceId,
    status: state.connectionStatus,
    connected: state.connectionStatus === "connected",
    qrAvailable: !!state.qrCodeDataURL,
    lastQrAt: state.lastQrAt,
  };
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

function renderQrHtml(state) {
  if (!state.qrCodeDataURL) {
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
          </style>
        </head>
        <body>
          <h2>QR ainda não disponível</h2>
          <p>Status: ${state.connectionStatus}</p>
          <p>Atualize em alguns segundos.</p>
        </body>
      </html>
    `;
  }

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
        <img src="${state.qrCodeDataURL}" alt="QR Code" />
        <p>Status: ${state.connectionStatus}</p>
        <p>Gerado em: ${state.lastQrAt || "-"}</p>
        <p>Instância: ${state.instanceId}</p>
      </body>
    </html>
  `;
}

async function startWhatsApp(instanceId) {
  const state = getInstanceState(instanceId);

  if (state.isStarting) return;
  state.isStarting = true;
  state.connectionStatus = "starting";

  try {
    const sessionPath = getSessionPath(instanceId);
    const { state: authState, saveCreds } =
      await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: authState,
      browser: ["Ubuntu", "Chrome", "20.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
    });

    state.sock = sock;

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
            instance_id: state.instanceId,
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

          console.log(`WEBHOOK ENVIADO [${state.instanceId}]:`, response.status);
        }
      } catch (error) {
        console.error(`ERRO WEBHOOK [${state.instanceId}]:`, error);
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        try {
          state.qrCodeDataURL = await QRCode.toDataURL(qr);
          state.lastQrAt = new Date().toISOString();
          state.connectionStatus = "qr_ready";
          console.log(`QR CODE GERADO [${state.instanceId}]`);
        } catch (err) {
          console.error(`ERRO AO CONVERTER QR [${state.instanceId}]:`, err);
        }
      }

      if (connection === "open") {
        state.connectionStatus = "connected";
        state.qrCodeDataURL = null;
        state.lastQrAt = null;
        console.log(`WHATSAPP CONECTADO [${state.instanceId}]`);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`CONEXAO FECHADA [${state.instanceId}]:`, statusCode);

        state.connectionStatus = "disconnected";
        state.sock = null;

        if (statusCode !== DisconnectReason.loggedOut) {
          if (state.reconnectTimeout) {
            clearTimeout(state.reconnectTimeout);
          }

          state.reconnectTimeout = setTimeout(() => {
            console.log(`TENTANDO RECONECTAR [${state.instanceId}]...`);
            startWhatsApp(state.instanceId);
          }, 5000);
        } else {
          console.log(`SESSAO ENCERRADA [${state.instanceId}]`);
        }
      }

      console.log(`STATUS ATUAL [${state.instanceId}]:`, {
        connectionStatus: state.connectionStatus,
        qrAvailable: !!state.qrCodeDataURL,
        lastQrAt: state.lastQrAt,
      });
    });
  } catch (error) {
    console.error(`ERRO AO INICIAR WHATSAPP [${state.instanceId}]:`, error);
    state.connectionStatus = "error";
  } finally {
    state.isStarting = false;
  }
}

app.post("/instances/:instanceId/connect", authMiddleware, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const state = getInstanceState(instanceId);

    if (state.connectionStatus !== "connected" && !state.isStarting) {
      await startWhatsApp(state.instanceId);
    }

    return res.json({
      success: true,
      ...buildStatus(state),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error?.message || "Falha ao conectar instância",
    });
  }
});

app.get("/instances/:instanceId/status", authMiddleware, (req, res) => {
  try {
    const state = getInstanceState(req.params.instanceId);
    return res.json(buildStatus(state));
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error?.message || "Falha ao obter status da instância",
    });
  }
});

app.get("/instances/:instanceId/qr", authMiddleware, (req, res) => {
  try {
    const state = getInstanceState(req.params.instanceId);
    return res.json({
      ...buildStatus(state),
      qrCode: state.qrCodeDataURL,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error?.message || "Falha ao obter QR da instância",
    });
  }
});

app.get("/instances/:instanceId/qr-image", authMiddleware, (req, res) => {
  try {
    const state = getInstanceState(req.params.instanceId);

    if (!state.qrCodeDataURL) {
      return res
        .status(404)
        .send("<h1>QR ainda não disponível. Atualize em alguns segundos.</h1>");
    }

    return res.send(renderQrHtml(state));
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error?.message || "Falha ao renderizar QR da instância",
    });
  }
});

app.post(
  "/instances/:instanceId/send-message",
  authMiddleware,
  async (req, res) => {
    try {
      const state = getInstanceState(req.params.instanceId);

      if (!state.sock || state.connectionStatus !== "connected") {
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

      const result = await state.sock.sendMessage(toJid(number), { text });

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
  }
);

app.post("/instances/:instanceId/logout", authMiddleware, async (req, res) => {
  try {
    const state = getInstanceState(req.params.instanceId);

    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
      state.reconnectTimeout = null;
    }

    if (state.sock) {
      await state.sock.logout();
    }

    state.sock = null;
    state.qrCodeDataURL = null;
    state.lastQrAt = null;
    state.connectionStatus = "disconnected";

    return res.json({
      success: true,
      ...buildStatus(state),
    });
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
});