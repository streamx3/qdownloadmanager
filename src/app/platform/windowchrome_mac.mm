// SPDX-License-Identifier: MIT
// Adapted from Dr Stein. Keep AppKit's traffic lights, resizing and fullscreen.
#include "windowchrome.h"
#include <QGuiApplication>
#import <AppKit/AppKit.h>
#include <cmath>

namespace {
NSWindow *nativeWindow(QWindow *window) {
    // The offscreen/minimal test plugins do not return an NSView from winId().
    if (!window || QGuiApplication::platformName() != "cocoa") return nil;
    NSView *view = (__bridge NSView *)reinterpret_cast<void *>(window->winId());
    return view.window;
}
}
int WindowChrome::leftInset() const { return 80; }
bool WindowChrome::nativeButtons() const { return true; }
void WindowChrome::attach(QWindow *window) {
    NSWindow *ns = nativeWindow(window);
    if (!ns) return;
    ns.titleVisibility = NSWindowTitleHidden;
    ns.titlebarAppearsTransparent = YES;
    if (@available(macOS 11.0, *)) {
        NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"qdownloadmanager.chrome"];
        ns.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
        ns.toolbar = toolbar;
        ns.toolbarStyle = NSWindowToolbarStyleUnified;
    }
}
void WindowChrome::setDark(QWindow *window, bool dark) {
    NSWindow *ns = nativeWindow(window);
    if (ns) ns.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
}
QVariantMap WindowChrome::metrics(QWindow *window) const {
    NSWindow *ns = nativeWindow(window);
    if (!ns) return {};
    NSButton *close = [ns standardWindowButton:NSWindowCloseButton];
    NSButton *zoom = [ns standardWindowButton:NSWindowZoomButton];
    if (!close || !zoom) return {};
    const NSRect c = [close convertRect:close.bounds toView:nil];
    const NSRect z = [zoom convertRect:zoom.bounds toView:nil];
    return {{"lightsCenterY", int(std::lround(ns.frame.size.height - NSMidY(c)))},
            {"leftInset", int(std::lround(NSMaxX(z) + 14))}};
}
