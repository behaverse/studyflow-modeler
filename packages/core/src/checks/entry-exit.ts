import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { quoted } from '@core/checks/graph';
import type { Element, StudyModel } from '@core/model/index';

/**
 * What a participant meets on the way in and is handed on the way out: the consent form a start event links, a link
 * a page can fetch (an address, or a path from the site's root); and the completion code an end event promises, which
 * a static code must hold and a redirect carrying `{COMPLETION_CODE}` must be given. A `{placeholder}` is read at run
 * time.
 */
export function checkEntryExit(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const text = (element: Element, name: string): string => {
    const value = model.attributeOrDefault(element, name);
    return typeof value === 'string' ? value : '';
  };
  for (const element of model.all()) {
    const report = (message: string): void => { issues.push({ severity: 'error', elementId: model.ownerOf(element), message }); };
    if (model.isA(element, BPMN.StartEvent)) {
      const consent = text(element, 'consentFormUri');
      if (consent && !/^(https?:|\/|\{)/i.test(consent)) {
        report(`${quoted(element)} links the consent form "${consent}", which is neither a URL nor an absolute path: set consentFormUri to an https:// address or a path starting with "/"`);
      }
    }
    if (model.isA(element, BPMN.EndEvent)) {
      const code = text(element, 'completionCodeType') || 'none';
      if (code === 'static' && !text(element, 'completionCode')) {
        report(`${quoted(element)} has completionCodeType: static and no completionCode, so participants would get no code: type the code in completionCode, or switch completionCodeType to dynamic`);
      }
      if (code === 'none' && text(element, 'redirectTo').includes('{COMPLETION_CODE}')) {
        report(`${quoted(element)} redirects to a link carrying {COMPLETION_CODE} with completionCodeType: none, so the link would carry a blank code: set completionCodeType to static or dynamic, or drop the placeholder`);
      }
    }
  }
  return issues;
}
