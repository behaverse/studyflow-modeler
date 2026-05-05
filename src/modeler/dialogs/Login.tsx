import { useImperativeHandle, useContext, useState } from 'react';
import { Button, Dialog, DialogPanel, DialogTitle, Field, Fieldset, Label, Input } from '@headlessui/react';
import { APIKeyContext } from '../contexts';
import { executeCommand } from '../commands';
import { dialog as s } from '../styles';
import { URLS } from '../constants';

export function LoginDialog({ ref }: { ref: React.Ref<{ open: () => void }> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { setApiKey } = useContext(APIKeyContext);

  useImperativeHandle(ref, () => ({
    open() {
      setError(undefined);
      setIsOpen(true);
    },
  }), []);

  function close() {
    setIsOpen(false);
  }

  const login = async (formData: FormData) => {
    const api_key = formData.get('api_key');

    const result = await executeCommand(null, {
      type: 'login',
      apiKey: String(api_key || ''),
    });

    if (!result?.success) {
      setError(result.error);
      return;
    }

    if (result?.data?.apiKey !== undefined) {
      setApiKey(result.data.apiKey);
    }
    setError(result?.error);
    close();
  };

  const guestLogin = async () => {
    const result = await executeCommand(null, {
      type: 'login-as-guest',
    });

    if (result?.success && result?.data?.apiKey !== undefined) {
      setApiKey(result.data.apiKey);
    }
    setError(result?.error);
    close();
  };

  return (
    <Dialog open={isOpen} onClose={close} className={s.root}>
      <div className={s.backdrop}>
        <div className={s.centerLayout}>
          <DialogPanel className={`${s.panelMd} ${s.panel}`}>
            <DialogTitle as="h3" className={`${s.title} pb-6`}>
              Login
              <span className={s.closeButton} onClick={close}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <p className={`${s.body} pb-6`}>
               Make sure your key has the correct permissions. If you don't have a valid API key, please <a className={s.bodyLink} href={URLS.githubOrg} target="_blank">contact us</a>.
            </p>
            <form action={login}>
              <Fieldset className={s.fieldset}>
                <Field>
                  <Label className={s.label}>Behaverse API Key</Label>
                  <Input
                    name="api_key"
                    onChange={() => { setError(undefined) }}
                    className={s.input}
                    placeholder="Example: 12345adhjkl67890"
                  />
                </Field>
                <div className="flex justify-between items-center">
                  <div className="float-start">{error && <p className={s.errorText}>{error}</p>}</div>
                  <div className="float-end space-x-2">
                    <Button type="button" onClick={guestLogin} className={s.secondaryBtn}>Continue as Guest</Button>
                    <Button type="submit" className={`float-end ${s.primaryBtn}`}>Login</Button>
                  </div>
                </div>
              </Fieldset>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
