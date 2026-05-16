import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Description,
  Dialog,
  DialogPanel,
  DialogTitle,
  Field,
  Fieldset,
  Input,
  Label,
} from '@headlessui/react';
import { useModeler } from '../useModeler';
import { executeCommand } from '../commands';
import { dialog as s } from '../styles';
import { URLS } from '../constants';

type Status = string | ReactElement | undefined;

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function PublishDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const [status, setStatus] = useState<Status>(undefined);
  const [showPublishButton, setShowPublishButton] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setShowPublishButton(true);
    setPreviewUrl(undefined);
    if (isOpen) setStatus(undefined);
  }, [isOpen]);

  function handlePublish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    setStatus('Publishing...');
    setShowPublishButton(false);

    executeCommand(modeler, {
      type: 'publish-diagram',
      studyName: String(formData.get('study_name') || ''),
      apiKey: String(formData.get('api_key') || ''),
    })
      .then((result: { previewUrl?: string }) => {
        setStatus('Published successfully.');
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
    <Dialog open={isOpen} className={s.root} onClose={onClose}>
      <div className={s.backdrop}>
        <div className={s.centerLayout}>
          <DialogPanel transition className={`${s.panelMd} ${s.panel}`}>
            <DialogTitle as="h3" className={`${s.title} pb-6`}>
              Publish
              <span className={s.closeButton} onClick={onClose}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <form onSubmit={handlePublish}>
              <Fieldset className={s.fieldset}>
                <Field>
                  <Label className={s.label}>Study Name</Label>
                  <Input name="study_name" className={s.input} placeholder="Example: my-study" />
                  <Description className={s.helpText}>
                    Use only lower-case letters, numbers, and hyphens
                  </Description>
                </Field>
                <Field>
                  <Label className={s.label}>Behaverse API Key</Label>
                  <Input name="api_key" className={s.input} placeholder="Example: 12345jdcj33kllk67890" />
                  <Description className={s.helpText}>
                    See the <a className={s.bodyLink} href={URLS.apiDocs} target="_blank">API docs</a> for more information
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
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
