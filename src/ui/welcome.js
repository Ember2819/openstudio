// First-launch tour: a one-time dialog pointing at the things people don't find on their own.
import { h } from '../util.js';
import { customDialog } from './dialog.js';
import { resolveCombo } from './tiling.js';

const KEY = 'openstudio.welcomed';

export function createWelcome(app) {
  const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

  async function show() {
    const mod = app.tiler?.cfg.mod ?? 'Alt';
    const item = (title, ...text) => h('section', { class: 'welcome-item' }, h('h4', {}, title), h('p', {}, ...text));
    const kbd = (k) => h('kbd', {}, k);

    const choice = await customDialog('Welcome to OpenStudio', [
      h('p', { class: 'welcome-lead' }, 'A few things worth knowing before you start.'),
      item('Windows', 'OpenStudio starts with ordinary floating windows you can drag around. We recommend ',
        h('b', {}, 'tiling mode'), ' — windows snap into columns on a sideways-scrolling strip and you drive them from the keyboard. Switch any time with ',
        kbd(resolveCombo('Mod+T', mod)), ' or in Settings → Windows & keys.'),
      item('Settings', 'Open the gear in the top right (', kbd('Ctrl+,'), ') to change the theme, accent colours and wallpaper, and to configure tiling and its key bindings.'),
      item('Updates', 'Use Help → Check for updates… to see if there is a newer version. OpenStudio can also check quietly on startup (toggle it in the same menu).'),
      item('AI agents (MCP)', 'OpenStudio runs a local MCP server so AI agents such as Claude Code can edit your project. Help → Agents (MCP server)… shows the address and how to connect.'),
    ], [
      { label: 'Try tiling mode', value: 'tiling' },
      { label: 'Get started', value: 'ok', primary: true },
    ], 'modal-welcome');

    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    if (choice === 'tiling') app.tiler?.enter();
  }

  /** Show once, the first time the app is launched. */
  function maybeShow() {
    if (seen() || window.studioAPI?.testRun) return;
    show();
  }

  return { show, maybeShow };
}
