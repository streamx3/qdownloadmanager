// SPDX-License-Identifier: MIT
// Dr Stein's integrated header conventions, sized for QDownloadManager.
pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts

Item {
    id: bar
    required property Window window
    property bool customChrome: true
    property bool nativeButtons: false
    property bool settingsOpen: false
    property bool setupComplete: false
    property int leftInset: 0
    property bool dark: true
    signal openSettings()
    signal goBack()
    signal addLink()
    signal toggleTheme()
    readonly property bool ownButtons: customChrome && !nativeButtons
    implicitHeight: 52

    DragHandler {
        target: null
        enabled: bar.customChrome
        onActiveChanged: if (active) bar.window.startSystemMove()
    }
    TapHandler {
        enabled: bar.customChrome && Qt.platform.os !== "osx"
        gesturePolicy: TapHandler.DragThreshold
        onDoubleTapped: bar.window.visibility === Window.Maximized ? bar.window.showNormal() : bar.window.showMaximized()
    }
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 12 + bar.leftInset
        anchors.rightMargin: bar.ownButtons ? 0 : 12
        spacing: 4
        ActionButton {
            objectName: "backButton"
            visible: bar.settingsOpen
            symbol: "back"; hint: "Back to downloads"; ghost: true; implicitWidth: 30
            onClicked: bar.goBack()
        }
        Text {
            text: bar.settingsOpen ? "Settings" : "QDownloadManager"
            Layout.fillWidth: true
            Layout.minimumWidth: 0
            elide: Text.ElideRight
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: 14
            font.weight: Font.Medium
        }
        ActionButton {
            objectName: "addLinkButton"
            visible: bar.setupComplete && !bar.settingsOpen
            symbol: "plus"; hint: "Download a link"; ghost: true; implicitWidth: 30
            onClicked: bar.addLink()
        }
        ActionButton {
            objectName: "themeToggle"
            symbol: bar.dark ? "sun" : "moon"
            hint: bar.dark ? "Switch to light theme" : "Switch to dark theme"
            ghost: true; implicitWidth: 30
            onClicked: bar.toggleTheme()
        }
        ActionButton {
            objectName: "settingsButton"
            visible: !bar.settingsOpen
            symbol: "settings"; hint: "Settings"; ghost: true; implicitWidth: 30
            onClicked: bar.openSettings()
        }
        WindowControls {
            visible: bar.ownButtons
            window: bar.window
            barHeight: bar.height
            Layout.alignment: linux ? Qt.AlignVCenter : Qt.AlignTop
        }
    }
}
