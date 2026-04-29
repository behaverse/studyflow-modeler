import type { CommandResult } from '../types';

export type PublishDiagramCommand = {
  type: 'publish-diagram';
  studyName: string;
  apiKey: string;
};

export async function runPublishDiagram(
  modeler: any,
  command: PublishDiagramCommand,
): Promise<CommandResult<{ preview_url?: string }>> {
  if (!modeler) {
    throw new Error("Command 'publish-diagram' requires a modeler instance.");
  }

  const { xml } = await modeler.saveXML({ format: true });

  const response = await fetch(`https://api.behaverse.org/v1/studies/${command.studyName}/flow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      Authorization: `Bearer ${command.apiKey}`,
    },
    body: xml,
  });

  if (response.status === 403 || response.status === 401) {
    throw new Error('Invalid API key');
  }

  if (!response.ok) {
    throw new Error(`Failed to publish (error ${response.status})`);
  }

  const data = await response.json();
  return {
    success: true,
    data,
  };
}
