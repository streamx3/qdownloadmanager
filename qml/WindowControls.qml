// SPDX-License-Identifier: MIT
// Layout and behavior adapted from Dr Stein; glyphs use our existing icon renderer.
pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls

Row {
    id: controls
    required property Window window
    property int barHeight: 48
    readonly property bool linux: Qt.platform.os === "linux"
    readonly property bool maximized: window.visibility === Window.Maximized || window.visibility === Window.FullScreen
    spacing: 0
    component CaptionButton: Button {
        id: button
        property string symbol
        property bool danger: false
        width: 46
        height: controls.linux ? controls.barHeight : 36
        hoverEnabled: true
        focusPolicy: Qt.StrongFocus
        Accessible.name: text
        ToolTip.visible: hovered
        ToolTip.text: text
        ToolTip.delay: 600
        background: Rectangle {
            color: button.down || button.hovered ? (button.danger ? "#e81123" : Theme.hover) : "transparent"
            border.width: button.activeFocus ? 2 : 0
            border.color: Theme.accent
        }
        contentItem: Item {
            Icon {
                anchors.centerIn: parent
                width: 14; height: 14
                name: button.symbol
                color: button.danger && (button.hovered || button.down) ? "white" : Theme.text
            }
        }
    }
    CaptionButton { objectName: "minimizeWindow"; text: "Minimize"; symbol: "minimize"; onClicked: controls.window.showMinimized() }
    CaptionButton {
        objectName: "maximizeWindow"
        text: controls.maximized ? "Restore" : "Maximize"
        symbol: controls.maximized ? "restore" : "maximize"
        onClicked: controls.maximized ? controls.window.showNormal() : controls.window.showMaximized()
    }
    CaptionButton { objectName: "closeWindow"; text: "Close"; symbol: "close"; danger: true; onClicked: controls.window.close() }
}
