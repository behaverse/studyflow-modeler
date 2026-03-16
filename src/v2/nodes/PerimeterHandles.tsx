import { Handle, Position } from '@xyflow/react';

type PerimeterHandlesProps = {
  allowSource?: boolean;
  allowTarget?: boolean;
};

const HANDLE_CLASS = '!bg-transparent !border-none !rounded-none';

function makeHandles(type: 'source' | 'target') {
  return [
    <Handle
      key={`${type}-top`}
      id={`${type}-top`}
      type={type}
      position={Position.Top}
      className={HANDLE_CLASS}
      style={{ width: '100%', height: 8, left: '50%', transform: 'translate(-50%, -50%)' }}
    />,
    <Handle
      key={`${type}-bottom`}
      id={`${type}-bottom`}
      type={type}
      position={Position.Bottom}
      className={HANDLE_CLASS}
      style={{ width: '100%', height: 8, left: '50%', transform: 'translate(-50%, -50%)' }}
    />,
    <Handle
      key={`${type}-left`}
      id={`${type}-left`}
      type={type}
      position={Position.Left}
      className={HANDLE_CLASS}
      style={{ width: 8, height: '100%', top: '50%', transform: 'translate(-50%, -50%)' }}
    />,
    <Handle
      key={`${type}-right`}
      id={`${type}-right`}
      type={type}
      position={Position.Right}
      className={HANDLE_CLASS}
      style={{ width: 8, height: '100%', top: '50%', transform: 'translate(-50%, -50%)' }}
    />,
  ];
}

export function PerimeterHandles({
  allowSource = true,
  allowTarget = true,
}: PerimeterHandlesProps) {
  return (
    <>
      {allowTarget ? makeHandles('target') : null}
      {allowSource ? makeHandles('source') : null}
    </>
  );
}
