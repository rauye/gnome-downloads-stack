// SPDX-FileCopyrightText: 2026 rauye
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const APP_ID = 'org.rauye.DownloadsStack';
const WINDOW_TITLE = 'Downloads Stack';
const REOPEN_GUARD_MS = 400;

const StackButton = GObject.registerClass(
class StackButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Downloads Stack', true);

        this._extension = extension;
        this._lastClosed = 0;
        this._window = null;
        this._laterId = 0;
        this._timeoutIds = new Set();

        this.add_child(new St.Icon({
            icon_name: 'folder-download-symbolic',
            style_class: 'system-status-icon',
        }));

        this._createdId = global.display.connect(
            'window-created', (_display, window) => this._onWindowCreated(window));
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS ||
            event.type() === Clutter.EventType.TOUCH_BEGIN)
            this._toggle();

        return Clutter.EVENT_PROPAGATE;
    }

    _toggle() {
        const elapsed = GLib.get_monotonic_time() / 1000 - this._lastClosed;
        if (this._window || elapsed < REOPEN_GUARD_MS) {
            this._window?.delete(global.get_current_time());
            return;
        }

        Gio.DBus.session.call(
            APP_ID,
            '/org/rauye/DownloadsStack',
            'org.freedesktop.Application',
            'Activate',
            new GLib.Variant('(a{sv})', [{}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (error) {
                    if (this._extension.enabled)
                        this._extension.spawnHelper(false);
                }
            });
    }

    _isHelperWindow(window) {
        if (window.get_title() !== WINDOW_TITLE)
            return false;

        // GTK exports _GTK_APPLICATION_ID on X11. Checking it prevents an
        // unrelated window with the same title from being moved or closed.
        return window.get_gtk_application_id?.() === APP_ID;
    }

    _onWindowCreated(window) {
        if (!this._isHelperWindow(window))
            return;

        this._clearWindowSources();
        this._window = window;
        window.connect('unmanaged', () => {
            if (this._window !== window)
                return;

            this._clearWindowSources();
            this._window = null;
            this._lastClosed = GLib.get_monotonic_time() / 1000;
        });

        const actor = window.get_compositor_private();
        if (!actor)
            return;

        actor.opacity = 0;
        let revealed = false;
        const reveal = () => {
            if (!revealed) {
                revealed = true;
                actor.opacity = 255;
            }
            return GLib.SOURCE_REMOVE;
        };

        this._laterId = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            if (this._window === window)
                this._place(window);
            this._addTimeout(40, reveal);
            return GLib.SOURCE_REMOVE;
        });
        this._addTimeout(250, reveal);
    }

    _addTimeout(interval, callback) {
        let sourceId = 0;
        sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._timeoutIds.delete(sourceId);
            return callback();
        });
        this._timeoutIds.add(sourceId);
    }

    _clearWindowSources() {
        if (this._laterId) {
            Meta.later_remove(this._laterId);
            this._laterId = 0;
        }

        for (const sourceId of this._timeoutIds)
            GLib.source_remove(sourceId);
        this._timeoutIds.clear();
    }

    _place(window) {
        const [buttonX] = this.get_transformed_position();
        const buttonWidth = this.get_width();
        const monitor = Main.layoutManager.findMonitorForActor(this);
        const windowRect = window.get_frame_rect();
        const [, panelY] = Main.panel.get_transformed_position();
        const panelBottom = panelY + Main.panel.height;

        let x = Math.round(buttonX + buttonWidth / 2 - windowRect.width / 2);
        x = Math.max(monitor.x + 8,
            Math.min(x, monitor.x + monitor.width - windowRect.width - 8));

        window.move_frame(true, x, panelBottom + 4);
        window.make_above();
        window.activate(global.get_current_time());
    }

    destroy() {
        this._clearWindowSources();

        if (this._createdId)
            global.display.disconnect(this._createdId);
        this._createdId = 0;

        this._window?.delete(global.get_current_time());
        this._window = null;
        super.destroy();
    }
});

export default class DownloadsStackExtension extends Extension {
    enable() {
        this.enabled = true;
        this._button = new StackButton(this);
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'right');

        // Create the button first so the helper's initial window-created
        // signal cannot be missed during warm-up.
        this.spawnHelper(true);
    }

    disable() {
        this.enabled = false;
        this._button?.destroy();
        this._button = null;

        Gio.DBus.session.call(
            APP_ID,
            '/org/rauye/DownloadsStack',
            'org.gtk.Actions',
            'Activate',
            new GLib.Variant('(sava{sv})', ['quit', [], {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null);
    }

    spawnHelper(daemon) {
        const script = GLib.build_filenamev([this.path, 'downloads-stack.js']);
        const argv = ['gjs', '-m', script];
        if (daemon)
            argv.push('--daemon');

        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (error) {
            logError(error, 'Downloads Stack: failed to start helper');
        }
    }
}
