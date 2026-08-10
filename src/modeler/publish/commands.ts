import { URLS } from '@/modeler/constants';
import type { Modeler } from '@/modeler/bpmn/types';

export type PublishDiagramCommand = {
  type: 'PublishDiagram';
  studyName: string;
  apiKey: string;
};

export type PublishResult = {
  previewUrl?: string;
};

export async function runPublishDiagram(modeler: Modeler, command: PublishDiagramCommand): Promise<PublishResult> {
  const { xml } = await modeler.saveXML({ format: true });

  const response = await fetch(`${URLS.apiBase}/v1/studies/${command.studyName}/flow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      Authorization: `Bearer ${command.apiKey}`,
    },
    body: xml,
  });

  if (response.status === 401 || response.status === 403) throw new Error('Invalid API key');
  if (!response.ok) throw new Error(`Failed to publish (error ${response.status})`);

  const body = await response.json();
  return { previewUrl: body?.data?.preview_url };
}
