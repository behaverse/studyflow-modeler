import PublishButton from './PublishButton';
import SimulateButton from './SimulateButton';
import DownloadButton from './DownloadButton';
import ExportButton from './ExportButton';

export function Toolbar() {

  return (
    <div className="h-9 inline-flex rounded-md shadow-sm" role="group">
      <SimulateButton />
      <span className="w-1"></span>
      <DownloadButton />
      <ExportButton />
      <PublishButton />
    </div>
  );

}
