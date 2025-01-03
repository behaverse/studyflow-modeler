import PublishButton from './PublishButton';
import SimulateButton from './SimulateButton';
import DownloadButton from './DownloadButton';

export function Toolbar() {

  return (
    <div className="fixed top-20 left-4 inline-flex rounded-md shadow-sm" role="group">
      <SimulateButton />
      <span className="w-1"></span>
      <DownloadButton />
      <PublishButton />
    </div>
  );

}
