export default class StudyflowContextPad {

  static $inject = ['contextPad'];

  constructor(contextPad) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element) {
    return function (entries) {
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];
      return entries;
    };
  }
}
