import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Description,
  Field,
  Fieldset,
  Input,
  Label,
} from '@headlessui/react';
import { Modal } from '@modeler/ui/Modal';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { dialog as s } from '@modeler/ui/styles';
import { URLS } from '@modeler/constants';

type Status = string | ReactElement | undefined;

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function PublishDialog({ isOpen, onClose }: Props) {
  const modeler = useRequiredModeler();
  const [status, setStatus] = useState<Status>(undefined);
  const [showPublishButton, setShowPublishButton] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);

  function handlePublish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    setStatus('Publishing...');
    setShowPublishButton(false);

    executeCommand(modeler, {
      type: 'PublishDiagram',
      studyName: String(formData.get('study_name') || ''),
      apiKey: String(formData.get('api_key') || ''),
    })
      .then((result: { previewUrl?: string }) => {
        setStatus('Published. Open the preview to check it.');
        setPreviewUrl(result.previewUrl);
      })
      .catch((err: any) => {
        console.error(err);
        setShowPublishButton(true);
        setPreviewUrl(undefined);
        setStatus(<div className="text-red-500">{err.message}</div>);
      });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Publish" size="sm" testId="publish-dialog">
      <form onSubmit={handlePublish}>
        <Fieldset className={s.fieldset}>
          <Field>
            <Label className={s.label}>Study name</Label>
            <Input name="study_name" className={s.input} placeholder="my-study" />
            <Description className={s.helpText}>
              Lower-case letters, numbers, and hyphens only.
            </Description>
          </Field>
          <Field>
            <Label className={s.label}>Behaverse API key</Label>
            <Input name="api_key" className={s.input} placeholder="Paste your key" />
            <Description className={s.helpText}>
              Sign in from Settings &gt; Account to get one, or see the{' '}
              <a className={s.bodyLink} href={URLS.apiDocs} target="_blank">API docs</a>.
            </Description>
          </Field>
          {status && (
            <div className="float-start inline-flex items-center py-1.5">
              <span className={s.statusText}>{status}</span>
            </div>
          )}
          {previewUrl && (
            <a href={previewUrl} target="_blank" className={`float-end ${s.previewBtn}`}>Preview</a>
          )}
          {showPublishButton && (
            <Button type="submit" className={`float-end inline-flex items-center gap-2 ${s.primaryBtn}`}>
              Publish
            </Button>
          )}
        </Fieldset>
      </form>
    </Modal>
  );
}
