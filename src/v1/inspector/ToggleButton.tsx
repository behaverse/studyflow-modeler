
interface ToggleButtonProps {
  isInspectorVisible: boolean;
  onClick: () => void;
}

export function ToggleButton({ isInspectorVisible, onClick }: ToggleButtonProps) {

  const position = isInspectorVisible ? 'right-[0.5rem]' : 'right-[0.5rem]';
  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible ? 'bi-arrow-bar-right' : 'bi-arrow-bar-left';

  return (
    <button
      onClick={onClick}
      className={`absolute ${position} top-2 bg-stone-150 hover:bg-stone-300 text-stone-700 p-2 rounded z-50`}
      title={title}
    >
      <i className={`bi ${icon}`}></i>
    </button>
  );
}
