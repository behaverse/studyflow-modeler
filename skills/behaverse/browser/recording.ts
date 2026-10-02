import { registerRunObserver } from '@runner/observers';
import { setRecordEvents, shouldRecordEvents } from '@skills/behaverse/account';
import { createSession, finishSession, loadDataServerConfig, type DataServerConfig, type SessionHandle } from '@skills/behaverse/browser/dataServer';
import { createEventRecorder, type EventRecorder } from '@skills/behaverse/browser/events';

/**
 * A run recorded on the Behaverse Data Server while "Record events" is on: a session for it, the events an embedded
 * task posts, and its variables and completion code once it ends. Offline, the run goes on and nothing is stored.
 */
let config: DataServerConfig = loadDataServerConfig();
let handle: SessionHandle | null = null;
let recorder: EventRecorder | null = null;

registerRunObserver({
  async start({ studyId, agentId, log }) {
    config = loadDataServerConfig(studyId);
    handle = await createSession(config, { agentId });
    log(
      handle.online ? 'info' : 'skip',
      handle.online
        ? `Connected to the Behaverse Data Server (session ${handle.sessionId}); responses will be uploaded.`
        : 'Not connected to the data server. Nothing will be stored.',
    );
    if (handle.online) {
      recorder = createEventRecorder({
        config,
        getAgentId: () => agentId,
        onFlush: (count, ok) => log(
          ok ? 'info' : 'skip',
          ok ? `Uploaded ${count} event(s) to the data server.` : `Could not upload ${count} event(s) to the data server; they were dropped.`,
        ),
      });
    }
    return { runId: handle.sessionId };
  },
  finish: ({ session, status, log }) => finishSession(config, handle, session, status, log),
  async close() {
    await recorder?.flush();
    recorder?.stop();
    recorder = null;
  },
  toggle: { label: 'Record events', get: shouldRecordEvents, set: setRecordEvents },
});
