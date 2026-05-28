/**
 * Thin client for the Behaverse data-server. Used by the runner to persist
 * session state and the final variable bag.
 *
 * Designed to be optional: if no data-server URL is configured, if the
 * `disable_data_server` flag is set, or if any HTTP call fails, the runner
 * falls back to a locally generated session ID and silently skips writes.
 * The flow keeps running either way.
 */

export type DataServerConfig = {
  /** Base URL of the data-server, e.g. `https://data.behaverse.org/v1`. */
  baseUrl?: string;
  /** Study name segment used in `/studies/{studyName}/...` paths. */
  studyName?: string;
  /** Bearer token for endpoints that require auth (events, etc.). */
  apiKey?: string;
  /** Explicit kill-switch even when baseUrl is set. */
  disabled?: boolean;
};

export type SessionHandle = {
  /** Server-issued ID when online, locally generated UUID when offline. */
  sessionId: string;
  /** True when subsequent writes will actually hit the server. */
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

/** Reads runner configuration from URL query params. */
export function readDataServerConfig(params: URLSearchParams): DataServerConfig {
  const disabled = params.get('disable_data_server');
  return {
    baseUrl: params.get('data_server_url') ?? undefined,
    studyName: params.get('study_name') ?? undefined,
    apiKey: params.get('data_server_api_key') ?? undefined,
    disabled: disabled === '1' || disabled === 'true',
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
  // Fallback for very old runtimes: timestamp + random bits, not RFC 4122 but unique enough.
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Creates a session on the server, or returns a local-only handle on failure. */
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

/** Patches the session with status / variables. No-op when offline. */
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
