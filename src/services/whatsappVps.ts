export interface WhatsAppVpsStatus {
  serverOnline: boolean;
  whatsappConnected: boolean;
  state: string;
  qrAvailable?: boolean;
  message?: string;
}

export interface WhatsAppVpsSendPayload {
  instanceId: string;
  phone: string;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 10000;

function getServerUrl() {
  const baseUrl = import.meta.env.VITE_WHATSAPP_SERVER_URL;
  if (!baseUrl) {
    throw new Error("Configuração ausente: defina VITE_WHATSAPP_SERVER_URL no ambiente do frontend.");
  }
  return baseUrl.replace(/\/$/, "");
}

async function requestJson(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${getServerUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} em ${path}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function requireInstanceId(instanceId: string) {
  const normalized = String(instanceId || "").trim();
  if (!normalized) {
    throw new Error("instanceId é obrigatório.");
  }
  return encodeURIComponent(normalized);
}

function normalizeStatus(raw: any): WhatsAppVpsStatus {
  const state = String(raw?.state || raw?.session || raw?.status || "").toLowerCase();

  const stateImpliesOnline = ["ok", "connected", "qr_ready", "starting", "disconnected", "open", "close", "session_open"].includes(state);
  const stateImpliesConnected = ["connected", "open", "session_open"].includes(state);

  const online =
    raw?.serverOnline ??
    raw?.online ??
    raw?.ok ??
    stateImpliesOnline;

  const connected =
    raw?.whatsappConnected ??
    raw?.connected ??
    raw?.isConnected ??
    stateImpliesConnected;

  const qrAvailable =
    raw?.qrAvailable ??
    Boolean(raw?.qrCode || raw?.qr || raw?.image || raw?.data);

  return {
    serverOnline: Boolean(online),
    whatsappConnected: Boolean(connected),
    state: state || (connected ? "connected" : "disconnected"),
    qrAvailable: Boolean(qrAvailable),
    message: raw?.message,
  };
}

export async function connectWhatsAppVpsInstance(instanceId: string) {
  const encodedInstanceId = requireInstanceId(instanceId);
  const data = await requestJson(`/instances/${encodedInstanceId}/connect`, {
    method: "POST",
  });
  return normalizeStatus(data);
}

export async function getWhatsAppVpsStatus(instanceId: string) {
  const encodedInstanceId = requireInstanceId(instanceId);
  const data = await requestJson(`/instances/${encodedInstanceId}/status`);
  return normalizeStatus(data);
}

export async function getWhatsAppVpsQrCode(instanceId: string) {
  const encodedInstanceId = requireInstanceId(instanceId);
  const data = await requestJson(`/instances/${encodedInstanceId}/qr`);
  const rawQr = data?.qr || data?.qrCode || data?.image || data?.data;
  if (!rawQr) return null;
  return String(rawQr).startsWith("data:image") ? String(rawQr) : `data:image/png;base64,${rawQr}`;
}

export async function sendWhatsAppVpsMessage(payload: WhatsAppVpsSendPayload) {
  const encodedInstanceId = requireInstanceId(payload.instanceId);
  return requestJson(`/instances/${encodedInstanceId}/send-message`, {
    method: "POST",
    body: JSON.stringify({
      phone: payload.phone,
      number: payload.phone,
      text: payload.text,
      message: payload.text,
    }),
  });
}
