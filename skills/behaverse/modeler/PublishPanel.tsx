import { useState, type FormEvent } from 'react';
import { Button, Description, Field, Input, Label } from '@headlessui/react';
import { useModeler } from '@modeler/app/useModeler';
import { saveDialog as s } from '@modeler/export/styles';
import { ICONS } from '@modeler/icons';
import { dialog as d } from '@modeler/ui/styles';
import { API_DOCS, getApiKey } from '@skills/behaverse/account';
import { publishStudy } from '@skills/behaverse/modeler/publish';

/** "Save" to the Behaverse server: the study's name there and the key to publish with, the signed-in one to begin with. */
export function PublishPanel() {
  const modeler = useModeler();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();

  async function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setStatus('Publishing...');
    setPreviewUrl(undefined);
    try {
      const result = await publishStudy(modeler, String(form.get('study_name') || ''), String(form.get('api_key') || ''));
      setStatus('Published. Open the preview to check it.');
      setPreviewUrl(result.previewUrl);
    } catch (err: any) {
      console.error(err);
      setStatus(null);
      setError(err?.message || 'Publishing failed. Check the study name and your connection, then retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={publish}>
      <div className={s.fields}>
        <Field>
          <Label className={d.label}>Study name</Label>
          <Input name="study_name" className={d.input} placeholder="my-study" />
          <Description className={d.helpText}>Lower-case letters, numbers, and hyphens only.</Description>
        </Field>
        <Field>
          <Label className={d.label}>Behaverse API key</Label>
          <Input name="api_key" type="password" className={d.input} placeholder="Paste your key" defaultValue={getApiKey() ?? ''} />
          <Description className={d.helpText}>
            Sign in from Settings &gt; Behaverse to get one, or see the{' '}
            <a className={d.bodyLink} href={API_DOCS} target="_blank" rel="noreferrer">API docs</a>.
          </Description>
        </Field>
      </div>

      <div className={s.footer}>
        <span className={s.filename} data-testid="export-filename">Sent to the Behaverse server</span>
        {previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noreferrer" className={`shrink-0 ${d.previewBtn}`}>Preview</a>
        ) : (
          <Button type="submit" disabled={busy} data-testid="save-submit" className={s.primaryBtn}>
            <i className={ICONS.broadcast}></i>
            {busy ? 'Working...' : 'Publish'}
          </Button>
        )}
      </div>
      {status && <p className={s.status}>{status}</p>}
      {error && <p className={s.error}>{error}</p>}
    </form>
  );
}
