import type { Editor } from '@modeler/editor/port';
import { API_BASE } from '@skills/behaverse/account';

/** The study, as BPMN XML, posted to the Behaverse server under `studyName`: the link to its preview. */
export async function publishStudy(modeler: Editor, studyName: string, apiKey: string): Promise<{ previewUrl?: string }> {
  const { xml } = await modeler.saveXML();

  const response = await fetch(`${API_BASE}/v1/studies/${encodeURIComponent(studyName)}/flow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      Authorization: `Bearer ${apiKey}`,
    },
    body: xml,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('The API key was rejected. Sign in again from Settings > Behaverse, then retry.');
  }
  if (!response.ok) {
    throw new Error(`Publishing failed (HTTP ${response.status}). Check the study name and your connection, then retry.`);
  }

  const body = await response.json();
  return { previewUrl: body?.data?.preview_url };
}
