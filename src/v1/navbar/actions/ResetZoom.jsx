import React, { useContext, forwardRef } from "react";
import { ModelerContext } from '../../contexts';
import { Button } from '@headlessui/react'

export const ResetZoomButton = forwardRef(function ResetZoomButton({ className, onClick, ...rest }, ref) {

  const { modeler } = useContext(ModelerContext);

  const handleClick = (e) => {
    if (modeler) {
      try {
        modeler.get('canvas').zoom('fit-viewport');
      } catch (err) {
        console.warn('Zoom to fit failed', err);
      }
    }
    if (typeof onClick === 'function') {
      onClick(e);
    }
  }

  return (
    <Button as="button"
            ref={ref}
            className={`w-full text-left ${className}`}
            onClick={handleClick}
          {...rest}>
      <i className="bi bi-fullscreen pe-2"></i> Reset Zoom
    </Button>
  );
});

export default ResetZoomButton;