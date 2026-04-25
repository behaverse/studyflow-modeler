import { useImperativeHandle, useContext, useState, forwardRef } from 'react';
import { Button, Dialog, DialogPanel, DialogTitle, Description, Field, Fieldset, Label, Input } from '@headlessui/react';
import { APIKeyContext } from '../../contexts';
import { executeCommand } from '../../commands';

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
    <Dialog open={isOpen} onClose={close} className="relative z-[101] focus:outline-none">
      <div className="fixed backdrop-blur inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel className="w-full max-w-md rounded-xl bg-stone-100 p-6 backdrop-blur-2xl duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]">
            <DialogTitle as="h3" className="text-base/7 text-stone-900 font-semibold pb-8">
              Login
              <span className="text-sm/6 text-black ml-2 float-end cursor-pointer" onClick={close}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <p className="text-sm text-stone-600 pb-6">
              To access this demo, you need a valid key. If you don&apos;t have one, please <a className="text-sky-500 hover:text-sky-600" href="https://github.com/behaverse" target="_blank">contact us</a>.
            </p>
            <form action={login}>
              <Fieldset className="space-y-6">
                <Field>
                  <Label className="text-sm font-medium">Behaverse API Key</Label>
                  <Input
                    name="api_key"
                    onChange={() => { setError(undefined) }}
                    className="mt-3 block w-full rounded-lg border-none bg-stone-200 py-1.5 px-3 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                    placeholder="Example: 12345adhjkl67890"
                  />
                  <Description className="text-xs text-stone-400 mt-1">
                    Make sure your key has the correct permissions.
                  </Description>
                </Field>
                <div className="flex justify-between items-center">
                  <div className="float-start">{error && <p className="text-red-500 text-sm">{error}</p>}</div>
                  <div className="float-end space-x-2">
                    <Button type="button" onClick={guestLogin} className="rounded-md bg-stone-300 py-1.5 px-3 text-sm/6 text-black hover:bg-stone-400 cursor-pointer">Continue as Guest</Button>
                    <Button type="submit" className="float-end rounded-md bg-sky-500 py-1.5 px-3 text-sm/6 text-white font-semibold hover:bg-sky-700 cursor-pointer">Login</Button>
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

export const LoginButton = forwardRef<HTMLButtonElement, { className?: string; onClick?: () => void; dialog?: React.RefObject<{ open: () => void } | null> }>(
  function LoginButton({ className, onClick, dialog }, ref) {
    const { apiKey } = useContext(APIKeyContext);
    const isGuest = !apiKey || apiKey === 'guest';

    return (
      <button
        ref={ref}
        title="Login with API Key"
        className={`w-full text-left ${className ?? ''}`}
        onClick={() => {
          dialog?.current?.open();
          onClick?.();
        }}
      >
        <i className="iconify bi--person pe-2"></i>
        {isGuest ? ' Login...' : ' Switch Account...'}
      </button>
    );
  }
);
