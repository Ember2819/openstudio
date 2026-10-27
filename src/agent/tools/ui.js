import { bool, choice, int, obj, ref } from '../schema.js';
import { automationOf, channelOf, fail, mixerTrackOf, patternOf } from '../helpers.js';

const WINDOWS = ['rack', 'piano', 'playlist', 'mixer', 'browser', 'settings', 'automation'];

export const tools = [
  {
    name: 'show_window',
    title: 'Show or hide a window',
    description: 'Open or close one of the app\'s windows so the user (or a screenshot) can see it: "rack" (channel rack), "piano" (piano roll, shows the selected channel), "playlist", "mixer", "browser" (side panel), "settings" (channel settings, needs `channel`), "automation" (curve editor, needs `automation`).',
    inputSchema: obj({
      window: choice(WINDOWS, 'Which window'),
      visible: bool('true (default) to show, false to hide'),
      channel: ref('Channel (for "settings")'),
      automation: int('Automation id (for "automation")'),
    }, ['window']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Show or hide a window' },
    run(a, app) {
      const show = a.visible ?? true;
      if (a.window === 'browser') {
        if (app.browserVisible() !== show) app.actions.toggleBrowser();
        return { window: 'browser', visible: app.browserVisible() };
      }
      if (show && a.window === 'settings') app.actions.openChannelSettings(channelOf(app.store, a.channel).id);
      else if (show && a.window === 'automation') {
        if (a.automation === undefined) fail('automation needs the automation id');
        app.actions.openAutomation(automationOf(app.store, a.automation).id);
      } else {
        const win = app.wm.get(a.window) ?? fail(`No window "${a.window}"`);
        if (show) win.show(); else win.hide();
      }
      return { window: a.window, visible: !!app.wm.get(a.window)?.visible };
    },
  },
  {
    name: 'set_selection',
    title: 'Set selection',
    description: 'Change what the editors show, like clicking in the app: the selected channel (piano roll / settings follow it), the current pattern (channel rack and pattern-mode playback), and the selected mixer track (effects panel).',
    inputSchema: obj({ channel: ref('Channel'), pattern: ref('Pattern'), mixerTrack: int('Mixer track 0-125', { minimum: 0, maximum: 125 }) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Set selection' },
    run(a, app) {
      const { store } = app;
      if (a.channel !== undefined) store.selectChannel(channelOf(store, a.channel).id);
      if (a.pattern !== undefined) store.selectPattern(patternOf(store, a.pattern).id);
      if (a.mixerTrack !== undefined) {
        mixerTrackOf(store, a.mixerTrack);
        store.project.selected.mixer = a.mixerTrack;
        store.emit('mixerSelection');
      }
      const s = store.project.selected;
      return { channel: s.channel, pattern: s.pattern, mixerTrack: s.mixer };
    },
  },
];
