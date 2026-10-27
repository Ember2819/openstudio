import { confirmDialog, messageDialog, progressDialog } from './dialog.js';

const AUTO_KEY = 'openstudio.updates.auto';
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
const label = (version, build) => `${version}${build ? ` (build ${build})` : ''}`;

/**
 * In-app updates: checks GitHub for a newer release and, on one click, downloads and installs it.
 * All network and file work happens in the main process (main.js / updater.js); this is only the UI.
 */
export function createUpdater(app) {
  const api = window.studioAPI?.updates;
  let info = null;
  let busy = false;

  const autoCheck = () => localStorage.getItem(AUTO_KEY) !== 'off';
  const setAutoCheck = (on) => localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');

  async function check({ silent = false } = {}) {
    if (!api) {
      if (!silent) await messageDialog('Updates unavailable', 'Updates can only be checked from the desktop app.');
      return;
    }
    if (busy) return;
    busy = true;
    try {
      info ??= await api.info();
      let res;
      try {
        res = await api.check();
      } catch (err) {
        if (!silent) await messageDialog('Could not check for updates', err.message);
        return;
      }
      app.toolbar.setUpdateAvailable?.(res.status === 'available' ? label(res.latest.version, res.latest.build) : null);
      if (silent) return;

      const here = label(info.version, info.build);
      if (res.status === 'current') {
        await messageDialog('OpenStudio is up to date', `You have the latest version (${here}).`);
      } else if (res.status === 'unknown') {
        const open = await confirmDialog('Development build',
          `This copy was not built by the release pipeline, so it can't tell whether it is out of date.\n\nLatest release: ${res.latest.name}.`, 'View release');
        if (open) api.openRelease();
      } else {
        await offer(res, here);
      }
    } finally {
      busy = false;
    }
  }

  async function offer(res, here) {
    const there = label(res.latest.version, res.latest.build);
    if (!res.downloadable) {
      const open = await confirmDialog('Update available',
        `OpenStudio ${there} is available (you have ${here}), but there is no package for this system.\n\nOpen the release page instead?`, 'View release');
      if (open) api.openRelease();
      return;
    }
    const ok = await confirmDialog('Update available',
      `OpenStudio ${there} is available. You have ${here}.\n\nDownload size: ${mb(res.size)}${info.inPlace ? '' : '\nThe installer will be saved to your Downloads folder.'}`,
      info.inPlace ? 'Download & install' : 'Download');
    if (ok) await install(res);
  }

  async function install(res) {
    const dlg = progressDialog('Updating OpenStudio', 'Starting download…');
    let cancelled = false;
    dlg.done.then(() => { cancelled = true; api.cancel(); });
    const off = api.onProgress(({ received, total }) => {
      dlg.set(total ? received / total : null, total ? `Downloading… ${mb(received)} of ${mb(total)}` : `Downloading… ${mb(received)}`);
    });

    let result;
    try {
      result = await api.install();
    } catch (err) {
      if (!cancelled) {
        dlg.close();
        await messageDialog('Update failed', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
      return;
    } finally {
      off();
    }
    dlg.close();

    if (result.action === 'manual') {
      await messageDialog('Update downloaded', app.store && info.platform === 'darwin'
        ? `The installer was opened from:\n${result.path}\n\nDrag OpenStudio into Applications to finish updating.`
        : `Saved to:\n${result.path}\n\nClose OpenStudio and run the new version to finish updating.`);
      return;
    }
    // Installed in place — only the restart is left. Don't throw away unsaved work without asking.
    if (app.store.dirty) {
      const go = await confirmDialog('Update installed', 'Restart OpenStudio now to start the new version?\n\nYour current project has unsaved changes. Choose Cancel to keep working; the update applies the next time you start OpenStudio.', 'Restart now');
      if (!go) return;
    }
    await api.restart();
  }

  // quiet startup check: only lights up the toolbar pill when something newer exists
  if (api) {
    api.info().then((i) => {
      info = i;
      if (i.autoCheck && autoCheck()) setTimeout(() => check({ silent: true }), 4000);
    });
  }

  return { check, autoCheck, setAutoCheck };
}
