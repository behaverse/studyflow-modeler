import { getApiKey, shouldRecordEvents } from '@core/settings';
import type { Session } from '@runner/session';
import type { LogFn } from '@runner/nodes/types';

export const DATA_SERVER_URL = 'https://data.behaverse.org/v1';

export type DataServerConfig = {
  baseUrl?: string;
  studyName?: string;
  apiKey?: string;
  disabled?: boolean;
};

export type SessionHandle = {
  sessionId: string;
  online: boolean;
};

type StartPayload = {
  agentId?: string;
  groupName?: string;
};

type UpdatePayload = {
  status?: 'started' | 'completed' | 'canceled';
  completionCode?: string;
  variables?: Record<string, unknown>;
};

export function loadDataServerConfig(): DataServerConfig {
  return {
    baseUrl: DATA_SERVER_URL,
    apiKey: getApiKey(),
    disabled: !shouldRecordEvents(),
  };
}

function canConnect(config: DataServerConfig): config is Required<Pick<DataServerConfig, 'baseUrl' | 'studyName'>> & DataServerConfig {
  return !!config.baseUrl && !!config.studyName && !config.disabled;
}

function buildHeaders(config: DataServerConfig, contentType?: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  return headers;
}

function localSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createSession(
  config: DataServerConfig,
  payload: StartPayload,
): Promise<SessionHandle> {
  if (!canConnect(config)) {
    return { sessionId: localSessionId(), online: false };
  }
  try {
    const response = await fetch(
      `${config.baseUrl}/studies/${encodeURIComponent(config.studyName!)}/sessions`,
      {
        method: 'POST',
        headers: buildHeaders(config, 'application/json'),
        body: JSON.stringify({
          agent_id: payload.agentId ?? localSessionId(),
          group_name: payload.groupName,
        }),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const sessionId = body?._id ?? body?.id;
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Server response missing session id.');
    return { sessionId, online: true };
  } catch {
    return { sessionId: localSessionId(), online: false };
  }
}

export async function updateSession(
  config: DataServerConfig,
  handle: SessionHandle,
  payload: UpdatePayload,
): Promise<boolean> {
  if (!handle.online || !canConnect(config)) return false;
  try {
    const response = await fetch(
      `${config.baseUrl}/studies/${encodeURIComponent(config.studyName!)}/sessions/${encodeURIComponent(handle.sessionId)}`,
      {
        method: 'PATCH',
        headers: buildHeaders(config, 'application/json'),
        body: JSON.stringify({
          status: payload.status,
          completion_code: payload.completionCode,
          variables: payload.variables,
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** Closes out a run: PATCHes the session's status, its variables, and the code the end node handed out. */
export async function finishSession(
  config: DataServerConfig,
  handle: SessionHandle | null,
  session: Session,
  status: 'completed' | 'canceled',
  log: LogFn,
): Promise<void> {
  if (!handle) return;
  const variables = session.getVariables();
  const completionCode = typeof variables['end.completionCode'] === 'string'
    ? (variables['end.completionCode'] as string)
    : undefined;
  const ok = await updateSession(config, handle, { status, variables, completionCode });
  if (handle.online) {
    log(ok ? 'info' : 'skip',
      ok
        ? `Session ${handle.sessionId} marked ${status}.`
        : `Failed to persist final state for session ${handle.sessionId}.`);
  }
}

export async function recordEvents(
  config: DataServerConfig,
  events: unknown[],
  agentId?: string,
): Promise<boolean> {
  if (!Array.isArray(events) || events.length === 0) return false;
  if (!canConnect(config)) return false;
  try {
    const base = `${config.baseUrl}/studies/${encodeURIComponent(config.studyName!)}/events`;
    const url = agentId ? `${base}?agent_id=${encodeURIComponent(agentId)}` : base;
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config, 'application/json'),
      body: JSON.stringify(events),
    });
    return response.ok;
  } catch {
    return false;
  }
}
