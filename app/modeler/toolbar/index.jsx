import PublishButton from './PublishButton';
import SimulateButton from './SimulateButton';
import DownloadButton from './DownloadButton';
import ExportButton from './ExportButton';
import OpenButton from './OpenButton';
import ExtraMenuButton from './ExtraMenuButton';

export function Toolbar() {

  return (
    <div className="h-9 inline-flex rounded-md shadow-sm" role="group">
      <SimulateButton />
      <span className="w-1"></span>
      <OpenButton />
      <DownloadButton />
      <ExportButton />
      <span className="w-1"></span>
      <PublishButton />
      <ExtraMenuButton />
    </div>
  );

}
