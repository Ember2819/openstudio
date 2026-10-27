import { Emitter } from './util.js';
import { Store } from './state.js';
import { Engine, loadSoundfont } from './audio/engine.js';
import { Transport } from './audio/transport.js';
import { WindowManager } from './ui/windows.js';
import { createToolbar } from './ui/toolbar.js';
import { createChannelRack } from './ui/channelrack.js';
import { createPianoRoll } from './ui/pianoroll.js';
import { createPlaylist } from './ui/playlist.js';
import { createMixer } from './ui/mixer.js';
import { createBrowser } from './ui/browser.js';
import { createUpdater } from './ui/updater.js';
import { createSettings } from './ui/settings.js';
import { createAutomationEditor } from './ui/autoeditor.js';
import { setAutomationHandler } from './ui/knob.js';
import { createActions } from './actions.js';
import { installShortcuts } from './shortcuts.js';
import { createInput } from './input.js';
import { messageDialog } from './ui/dialog.js';
import { initMidi } from './midi.js';
import { installAutosave } from './autosave.js';
import { installAgent } from './agent/index.js';
import { appearance } from './theme.js';
import { createPreferences } from './ui/prefs.js';
import { Tiler } from './ui/tiling.js';
import { createWelcome } from './ui/welcome.js';

// colours first, so nothing is ever drawn with an unthemed palette
appearance.apply();


const app = new Emitter();
app.store = new Store();
app.engine = new Engine(app.store);
app.transport = new Transport(app.store, app.engine);
app.wm = new WindowManager(document.getElementById('desktop'));
app.ui = { snap: 'line' };
app.browserVisible = () => !document.getElementById('browser').classList.contains('collapsed');
app.actions = createActions(app);
app.input = createInput(app);
app.appearance = appearance;

// the toolbar must exist first so windows are laid out against the real desktop size
app.toolbar = createToolbar(app);
const updater = createUpdater(app);
app.actions.checkForUpdates = () => updater.check();
app.actions.autoCheckUpdates = updater.autoCheck;
app.actions.setAutoCheckUpdates = updater.setAutoCheck;
const settings = createSettings(app);
app.actions.openChannelSettings = settings.open;
app.browser = createBrowser(app);
const rack = createChannelRack(app);
const playlist = createPlaylist(app);
const autoEditor = createAutomationEditor(app);
app.actions.openAutomation = autoEditor.open;
setAutomationHandler((target) => app.actions.createAutomation(target));
const piano = createPianoRoll(app);
const mixer = createMixer(app);
installShortcuts(app);
app.tiler = new Tiler(app);
const prefs = createPreferences(app);
app.actions.togglePreferences = prefs.toggle;
initMidi(app);
app.toolbar.refreshProject();
app.autosave = installAutosave(app);
app.autosave.offerRecovery();
createWelcome(app).maybeShow();

loadSoundfont().then(() => {
  app.store.emit('soundfontReady');
  app.store.emit('notes');
}).catch((err) => {
  console.error('Could not load the instrument bank', err);
  messageDialog('Instrument bank not found', 'OpenStudio could not load its sound library, so instruments will be silent.\n\nRun "npm run assets" in the project folder to download it, then restart the app.');
});

const panels = [rack, playlist, piano, mixer, settings];

let lastDirty = app.store.dirty;
function frame() {
  // edits only set store.dirty, so keep the "unsaved" markers in step here
  if (app.store.dirty !== lastDirty) { lastDirty = app.store.dirty; syncTitle(); app.toolbar.refreshProject(); }
  app.toolbar.update();
  for (const p of panels) p.update?.();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// window title follows the project name
const syncTitle = () => window.studioAPI?.setTitle(`${app.store.dirty ? '*' : ''}${app.store.project.name} — OpenStudio`);
app.store.on('project', syncTitle);
syncTitle();

// MCP: lets AI agents drive the project through the server in the main process (src/agent)
installAgent(app);

window.openstudio = app; // handy for debugging from devtools
