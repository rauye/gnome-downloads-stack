#!/usr/bin/env -S gjs -m

// SPDX-FileCopyrightText: 2026 rauye
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GdkX11 from 'gi://GdkX11?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

const APP_ID = 'org.rauye.DownloadsStack';
const TITLE = 'Downloads Stack';
const MAX_ITEMS = 40;
const PARTIAL_SUFFIXES = ['.part', '.crdownload', '.download', '.tmp'];
const FILE_ATTRIBUTES = [
    Gio.FILE_ATTRIBUTE_STANDARD_NAME,
    Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
    Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
    Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
].join(',');

const downloadsPath = GLib.get_user_special_dir(
    GLib.UserDirectory.DIRECTORY_DOWNLOAD) ?? GLib.build_filenamev([
    GLib.get_home_dir(),
    'Downloads',
]);

function humanSize(bytes) {
    let size = Number(bytes);
    for (const unit of ['B', 'KB', 'MB', 'GB']) {
        if (size < 1024 || unit === 'GB')
            return unit === 'B' ? `${size.toFixed(0)} ${unit}` : `${size.toFixed(1)} ${unit}`;
        size /= 1024;
    }

    return `${size.toFixed(1)} GB`;
}

function humanAge(timestamp) {
    const age = Date.now() / 1000 - timestamp;
    if (age < 60)
        return 'now';
    if (age < 3600)
        return `${Math.floor(age / 60)} min ago`;
    if (age < 86400)
        return `${Math.floor(age / 3600)} h ago`;
    if (age < 86400 * 30)
        return `${Math.floor(age / 86400)} d ago`;

    return GLib.DateTime.new_from_unix_local(timestamp).format('%x');
}

function listDownloads() {
    const directory = Gio.File.new_for_path(downloadsPath);
    let enumerator;
    try {
        enumerator = directory.enumerate_children(
            FILE_ATTRIBUTES,
            Gio.FileQueryInfoFlags.NONE,
            null);
    } catch (error) {
        if (!error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
            console.error(`Unable to read Downloads folder: ${error.message}`);
        return [];
    }

    const items = [];
    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            const lowerName = name.toLowerCase();
            if (name.startsWith('.') || PARTIAL_SUFFIXES.some(suffix => lowerName.endsWith(suffix)))
                continue;

            items.push({
                modified: Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED)),
                path: GLib.build_filenamev([downloadsPath, name]),
                size: Number(info.get_size()),
                isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
            });
        }
    } catch (error) {
        console.error(`Unable to enumerate Downloads folder: ${error.message}`);
    } finally {
        try {
            enumerator.close(null);
        } catch (error) {
            console.error(`Unable to close Downloads enumerator: ${error.message}`);
        }
    }

    items.sort((left, right) => right.modified - left.modified ||
        right.path.localeCompare(left.path));
    return items.slice(0, MAX_ITEMS);
}

const DownloadsWindow = GObject.registerClass(
class DownloadsWindow extends Adw.ApplicationWindow {
    _init(application) {
        super._init({
            application,
            title: TITLE,
            default_width: 360,
            default_height: 520,
            decorated: false,
            resizable: false,
        });

        this.dragging = false;
        this._rowCache = new Map();
        this._refreshId = 0;
        this._hideId = 0;

        const root = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        const header = new Gtk.Label({
            label: 'Downloads',
            xalign: 0,
            margin_top: 10,
            margin_bottom: 6,
            margin_start: 14,
            margin_end: 14,
        });
        header.add_css_class('heading');
        root.append(header);

        const scroll = new Gtk.ScrolledWindow({
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });
        this._listBox = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        this._listBox.add_css_class('navigation-sidebar');
        this._listBox.connect('row-activated', (_listBox, row) => this._openPath(row.path));
        scroll.set_child(this._listBox);
        root.append(scroll);

        const openButton = new Gtk.Button({
            label: 'Open Downloads Folder',
            margin_top: 6,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });
        openButton.connect('clicked', () => this._openPath(downloadsPath));
        root.append(openButton);
        this.set_content(root);

        this._populate();
        this._startMonitor();

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval) => {
            if (keyval !== Gdk.KEY_Escape)
                return false;

            this.hideWindow();
            return true;
        });
        this.add_controller(keys);

        this.connect('notify::is-active', () => this._onActiveChanged());
        this.connect('map', () => this._onMap());
        this.connect('close-request', () => {
            this.hideWindow();
            return true;
        });
    }

    _startMonitor() {
        try {
            this._monitor = Gio.File.new_for_path(downloadsPath).monitor_directory(
                Gio.FileMonitorFlags.NONE,
                null);
            this._monitor.connect('changed', () => this._onDirectoryChanged());
        } catch (error) {
            this._monitor = null;
            if (!error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
                console.error(`Unable to monitor Downloads folder: ${error.message}`);
        }
    }

    _onMap() {
        const surface = this.get_surface();
        if (!(surface instanceof GdkX11.X11Surface)) {
            console.error('Downloads Stack requires an X11 session');
            this.close();
            return;
        }

        surface.set_skip_taskbar_hint(true);
        surface.set_skip_pager_hint(true);
    }

    _onDirectoryChanged() {
        if (this._refreshId)
            GLib.source_remove(this._refreshId);

        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._refreshId = 0;
            this._populate();
            return GLib.SOURCE_REMOVE;
        });
    }

    _populate() {
        this._listBox.remove_all();
        const items = listDownloads();
        if (items.length === 0) {
            const exists = Gio.File.new_for_path(downloadsPath).query_exists(null);
            this._listBox.append(new Gtk.Label({
                label: exists ? 'Downloads folder is empty' : 'Downloads folder is unavailable',
                margin_top: 30,
                margin_bottom: 30,
            }));
            return;
        }

        const retainedRows = new Map();
        for (const item of items) {
            const key = `${item.path}\u0000${item.modified}\u0000${item.size}`;
            const row = this._rowCache.get(key) ?? this._makeRow(item);
            retainedRows.set(key, row);
            this._listBox.append(row);
        }
        this._rowCache = retainedRows;
    }

    _makeRow(item) {
        const file = Gio.File.new_for_path(item.path);
        const icon = new Gtk.Image({pixel_size: 40});
        try {
            const info = file.query_info(
                'standard::icon,thumbnail::path',
                Gio.FileQueryInfoFlags.NONE,
                null);
            const thumbnail = info.get_attribute_byte_string('thumbnail::path');
            if (thumbnail && GLib.file_test(thumbnail, GLib.FileTest.EXISTS))
                icon.set_from_file(thumbnail);
            else
                icon.set_from_gicon(info.get_icon());
        } catch (error) {
            icon.set_from_icon_name('text-x-generic');
        }

        const name = new Gtk.Label({
            label: GLib.path_get_basename(item.path),
            xalign: 0,
            ellipsize: Pango.EllipsizeMode.END,
            max_width_chars: 28,
        });
        const details = new Gtk.Label({
            label: `${item.isDirectory ? 'Folder' : humanSize(item.size)} · ${humanAge(item.modified)}`,
            xalign: 0,
        });
        details.add_css_class('dim-label');
        details.add_css_class('caption');

        const text = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });
        text.append(name);
        text.append(details);

        const box = new Gtk.Box({
            spacing: 10,
            margin_top: 4,
            margin_bottom: 4,
            margin_start: 8,
            margin_end: 8,
        });
        box.append(icon);
        box.append(text);

        const row = new Gtk.ListBoxRow({child: box});
        row.path = item.path;

        const dragSource = new Gtk.DragSource({actions: Gdk.DragAction.COPY});
        dragSource.connect('prepare', () => {
            this.dragging = true;
            return Gdk.ContentProvider.new_for_value(Gdk.FileList.new_from_list([file]));
        });
        dragSource.connect('drag-begin', source => {
            source.set_icon(Gtk.WidgetPaintable.new(icon), 20, 20);
        });
        dragSource.connect('drag-end', () => this._scheduleHide(200));
        row.add_controller(dragSource);
        return row;
    }

    _openPath(path) {
        const uri = Gio.File.new_for_path(path).get_uri();
        Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (_source, result) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(result);
            } catch (error) {
                console.error(`Unable to open ${uri}: ${error.message}`);
            }
        });
        this.hideWindow();
    }

    _onActiveChanged() {
        if (!this.is_active && !this.dragging)
            this._scheduleHide(150);
    }

    _scheduleHide(interval) {
        if (this._hideId)
            GLib.source_remove(this._hideId);

        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._hideId = 0;
            if (!this.is_active || this.dragging)
                this.hideWindow();
            return GLib.SOURCE_REMOVE;
        });
    }

    hideWindow() {
        this.dragging = false;
        this.set_visible(false);
    }

    destroy() {
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._monitor?.cancel();
        super.destroy();
    }
});

const DownloadsApplication = GObject.registerClass(
class DownloadsApplication extends Adw.Application {
    _init(daemon) {
        super._init({
            application_id: APP_ID,
            flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
        });

        this._daemon = daemon;
        this._window = null;
        const quitAction = new Gio.SimpleAction({name: 'quit'});
        quitAction.connect('activate', () => this.quit());
        this.add_action(quitAction);
    }

    vfunc_activate() {
        if (!this._window) {
            this.hold();
            this._window = new DownloadsWindow(this);
        }

        if (this._daemon) {
            this._daemon = false;
            this._warmUp();
        } else if (this._window.get_opacity() === 0) {
            this._window.set_opacity(1);
        } else if (this._window.get_visible()) {
            this._window.hideWindow();
        } else {
            this._window.dragging = false;
            this._window.present();
        }
    }

    _warmUp() {
        this._window.set_opacity(0);
        this._window.present();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
            this._window.hideWindow();
            this._window.set_opacity(1);
            return GLib.SOURCE_REMOVE;
        });
    }
});

const daemon = ARGV.includes('--daemon');
const application = new DownloadsApplication(daemon);
application.run(ARGV.filter(argument => argument !== '--daemon'));
