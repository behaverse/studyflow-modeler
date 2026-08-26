import { URLS } from '@modeler/constants';
import { getEditorPort } from '@modeler/editor/registry';
import type { PortHandle } from '@modeler/editor/registry';

export type PublishDiagramCommand = {
  type: 'PublishDiagram';
  studyName: string;
  apiKey: string;
};

export type PublishResult = {
  previewUrl?: string;
};

export async function runPublishDiagram(modeler: PortHandle, command: PublishDiagramCommand): Promise<PublishResult> {
  const { xml } = await getEditorPort(modeler).saveXML({ format: true });

  const response = await fetch(`${URLS.apiBase}/v1/studies/${command.studyName}/flow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      Authorization: `Bearer ${command.apiKey}`,
    },
    body: xml,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('The API key was rejected. Sign in again from Settings > Account, then retry.');
  }
  if (!response.ok) {
    throw new Error(`Publishing failed (HTTP ${response.status}). Check the study name and your connection, then retry.`);
  }

  const body = await response.json();
  return { previewUrl: body?.data?.preview_url };
}
