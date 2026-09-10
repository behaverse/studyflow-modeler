/** What the jspsych skill gives the modeler: opening a timeline as a studyflow. */
import type { ModelerModule } from '@modeler/skillModules';

import { buildStudyflowXml } from './studyflowDocument';
import { importJsPsychTimeline } from './timeline';

export default {
  opens: [{
    label: 'jsPsych timeline',
    extension: '.json',
    mimeType: 'application/json',
    async toXml(text, { name, packages, warn }) {
      const study = importJsPsychTimeline(text, { name });
      for (const warning of study.warnings) console.warn(`jsPsych import: ${warning}`);
      if (study.warnings.length > 0) {
        warn(`The jsPsych import made ${study.warnings.length} adjustment${study.warnings.length === 1 ? '' : 's'}. `
          + `Check in the inspector:\n• ${study.warnings.join('\n• ')}`);
      }
      return buildStudyflowXml(study, packages);
    },
  }],
} satisfies ModelerModule;
