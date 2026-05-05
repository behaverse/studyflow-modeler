import { Button } from '@headlessui/react';

export function PublishButton({ className, dialog }) {
  return (
    <Button
      title="Publish"
      id="publish-button"
      className={`w-full text-left ${className}`}
      onClick={dialog.current?.open}>
      <i className="iconify bi--broadcast-pin pe-2"></i> Publish...
    </Button>
  );
}
