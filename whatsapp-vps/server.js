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

const WEBHOOK_URL =
  "https://uhumbtpkioisepqiqotl.supabase.co/functions/v1/whatsapp-webhook-baileys";

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

async function startWhatsApp(instanceId) {
  const state = getInstanceState(instanceId);

  if (state.isStarting) return;
  state.isStarting = true;
  state.connectionStatus = "starting";

  try {
    const sessionPath = getSessionPath(instanceId);
    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionPath);

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

          const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization:
                "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVodW1idHBraW9pc2VwcWlxb3RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDc2ODMsImV4cCI6MjA4NzQ4MzY4M30.zrh-0co_dhQTFg55Ou2V9pF1udV_XvQTthqHrj1fafI",
            },
            body: JSON.stringify(payload),
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

        if (statusCode !== DisconnectReason.loggedOut) {
          if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
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

app.post("/instances/:instanceId/connect", async (req, res) => {
  try {
    const { instanceId } = req.params;
    const state = getInstanceState(instanceId);

    if (state.connectionStatus !== "connected" && !state.isStarting) {
      await startWhatsApp(state.instanceId);
    }

    return res.json({ success: true, ...buildStatus(state) });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error?.message || "Falha ao conectar instância",
    });
  }
});

app.get("/instances/:instanceId/status", (req, res) => {
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

app.get("/instances/:instanceId/qr", (req, res) => {
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

app.post("/instances/:instanceId/send-message", async (req, res) => {
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
});

app.post("/instances/:instanceId/logout", async (req, res) => {
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

    return res.json({ success: true, ...buildStatus(state) });
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
});
