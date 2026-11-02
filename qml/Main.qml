import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs

ApplicationWindow {
    id: window
    width: 400
    height: 680
    minimumWidth: 380
    minimumHeight: 580
    visible: true
    title: "QDownloadManager"
    color: Theme.background
    font.family: Theme.fontFamily
    property bool settingsOpen: false
    readonly property bool customChrome: startupCustomTitleBar
    readonly property bool framelessChrome: customChrome && Qt.platform.os !== "osx" && Qt.platform.os !== "windows"
    property bool chromeReady: false
    property var chromeMetrics: ({})
    readonly property color themeBackground: Theme.background
    readonly property bool darkTheme: Theme.dark
    flags: !customChrome ? Qt.Window
         : framelessChrome ? (Qt.Window | Qt.FramelessWindowHint)
         : (Qt.Window | Qt.ExpandedClientAreaHint | Qt.NoTitleBarBackgroundHint)
    // Our header occupies the safe title-bar band rather than starting below it.
    topPadding: customChrome ? 0 : window.SafeArea.margins.top
    palette.window: Theme.background
    palette.windowText: Theme.text
    palette.base: Theme.surface
    palette.text: Theme.text
    palette.button: Theme.surface
    palette.buttonText: Theme.text
    palette.highlight: Theme.accentDark
    palette.highlightedText: Theme.accentText
    Binding { target: Theme; property: "paletteName"; value: backend.themePalette }
    Binding { target: Theme; property: "colorScheme"; value: backend.colorScheme }
    Binding { target: backend; property: "renderedTheme"; value: Theme.renderedTheme }
    function measureChrome() { if (chromeReady && customChrome) chromeMetrics = windowChrome.metrics(window) }
    Component.onCompleted: {
        if (customChrome) windowChrome.attach(window)
        chromeReady = true
        windowChrome.setDark(window, Theme.dark)
        Qt.callLater(measureChrome)
    }
    Connections {
        target: Theme
        function onDarkChanged() { if (window.chromeReady) windowChrome.setDark(window, Theme.dark) }
    }
    onVisibilityChanged: Qt.callLater(measureChrome)
    Timer { interval: 150; running: true; onTriggered: window.measureChrome() }
    Shortcut { sequences: [StandardKey.Preferences]; onActivated: window.settingsOpen = !window.settingsOpen }
    Shortcut { sequences: [StandardKey.Close]; onActivated: window.close() }
    readonly property string connectionTitle: backend.serverError ? "Connection unavailable" : !backend.accepting ? "New downloads paused" : backend.browserCount > 0 ? "Chrome connected" : "Waiting for Chrome"
    readonly property string connectionDetail: backend.serverError ? backend.serverError : backend.browserCount > 0 ? "This computer · " + backend.browserCount + (backend.browserCount === 1 ? " browser connection" : " browser connections") : "Open the extension and click Connect."

    onClosing: close => {
        if (backend.keepInTray && trayAvailable) {
            close.accepted = false
            window.hide()
        }
    }

    component BodyText: Text {
        color: Theme.muted
        font.family: Theme.fontFamily
        font.pixelSize: 12
        wrapMode: Text.Wrap
        textFormat: Text.PlainText
        Layout.fillWidth: true
        lineHeight: 1.3
    }
    component TitleText: Text {
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: 15
        font.weight: Font.Medium
        textFormat: Text.PlainText
    }
    component Card: Rectangle {
        color: Theme.surface
        radius: Theme.radius
        Layout.fillWidth: true
    }
    component Toggle: Switch {
        id: control
        implicitWidth: 38
        implicitHeight: 30
        padding: 2
        indicator: Rectangle {
            x: 2; y: 6; width: 32; height: 18; radius: 9
            color: control.checked ? Theme.accentDark : "transparent"
            border.width: control.activeFocus ? 2 : 1
            border.color: control.checked || control.activeFocus ? Theme.accent : Theme.dim
            Rectangle { x: control.checked ? 17 : 3; y: 3; width: 12; height: 12; radius: 6; color: control.checked ? Theme.accentText : Theme.dim; Behavior on x { NumberAnimation { duration: 100 } } }
        }
    }

    background: Rectangle {
        gradient: Gradient { GradientStop { position: 0; color: Theme.background } GradientStop { position: 1; color: Theme.bottom } }
    }

    FolderDialog {
        id: folderDialog
        title: "Choose where images are saved"
        onAccepted: backend.chooseFolder(selectedFolder)
    }

    Dialog {
        id: urlDialog
        anchors.centerIn: parent
        width: Math.min(window.width - 32, 360)
        modal: true
        title: "Download a link"
        padding: 18
        background: Rectangle { color: Theme.surface; radius: 12; border.color: Theme.edge }
        header: TitleText { text: urlDialog.title; padding: 18 }
        ColumnLayout {
            width: parent.width
            spacing: 12
            BodyText { text: "For public HTTP or HTTPS files. Use the Chrome button for images that need your browser session." }
            TextField {
                id: urlInput
                Layout.fillWidth: true
                placeholderText: "https://example.com/image.jpg"
                color: Theme.text
                placeholderTextColor: Theme.dim
                selectionColor: Theme.accentDark
                font.pixelSize: 12
                background: Rectangle { color: Theme.background; radius: 6; border.color: urlInput.activeFocus ? Theme.accent : Theme.edge }
                onAccepted: { if (text.trim()) { backend.addUrl(text); urlDialog.close() } }
            }
            RowLayout {
                Layout.alignment: Qt.AlignRight
                ActionButton { text: "Cancel"; ghost: true; onClicked: urlDialog.close() }
                ActionButton { text: "Download"; primary: true; enabled: urlInput.text.trim().length > 0; onClicked: { backend.addUrl(urlInput.text); urlDialog.close() } }
            }
        }
        onOpened: { urlInput.clear(); urlInput.forceActiveFocus() }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        TitleBar {
            id: titleBar
            objectName: "titleBar"
            Layout.fillWidth: true
            Layout.preferredHeight: window.customChrome && window.chromeMetrics.lightsCenterY !== undefined
                ? Math.max(implicitHeight, window.chromeMetrics.lightsCenterY * 2) : implicitHeight
            window: window
            customChrome: window.customChrome
            nativeButtons: windowChrome.nativeButtons
            leftInset: !window.customChrome ? 0 : window.chromeMetrics.leftInset !== undefined ? window.chromeMetrics.leftInset : windowChrome.leftInset
            settingsOpen: window.settingsOpen
            setupComplete: backend.setupComplete
            dark: Theme.dark
            onOpenSettings: window.settingsOpen = true
            onGoBack: window.settingsOpen = false
            onAddLink: urlDialog.open()
            onToggleTheme: backend.colorScheme = Theme.dark ? "light" : "dark"
        }

        // Setup replaces the mockup's simulated OS permission prompts with real actions.
        ScrollView {
            visible: !backend.setupComplete && !window.settingsOpen
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth
            ColumnLayout {
                width: parent.width
                spacing: 18
                Item { height: 4 }
                ColumnLayout {
                    Layout.margins: 20
                    Layout.fillWidth: true
                    spacing: 18
                    Rectangle { width: 44; height: 44; radius: 10; color: Theme.accentDark; border.color: Theme.accent; Icon { anchors.centerIn: parent; width: 24; height: 24; color: Theme.accentText } }
                    ColumnLayout {
                        spacing: 7
                        TitleText { text: "Your images, right here."; font.pixelSize: 21 }
                        BodyText { text: "One click in Chrome. Saved to this computer, in the folder you choose."; font.pixelSize: 13 }
                    }
                    Card {
                        implicitHeight: setupFolder.implicitHeight + 26
                        ColumnLayout {
                            id: setupFolder
                            anchors { fill: parent; margins: 13 }
                            spacing: 8
                            TitleText { text: "1. Choose a folder"; font.pixelSize: 13 }
                            BodyText { text: backend.saveFolder; elide: Text.ElideMiddle; maximumLineCount: 2 }
                            ActionButton { text: "Choose folder…"; symbol: "folder"; onClicked: folderDialog.open() }
                        }
                    }
                    Card {
                        implicitHeight: setupBridge.implicitHeight + 26
                        ColumnLayout {
                            id: setupBridge
                            anchors { fill: parent; margins: 13 }
                            spacing: 8
                            TitleText { text: "2. Connect the local app"; font.pixelSize: 13 }
                            BodyText { text: "Register the small bridge Chrome uses to reach this app. No server or account needed." }
                            ActionButton { text: backend.bridgeInstalled ? "Bridge registered" : "Register Chrome bridge"; symbol: backend.bridgeInstalled ? "check" : "link"; enabled: !backend.bridgeInstalled; onClicked: backend.installBridge() }
                        }
                    }
                    Card {
                        implicitHeight: setupExtension.implicitHeight + 26
                        ColumnLayout {
                            id: setupExtension
                            anchors { fill: parent; margins: 13 }
                            spacing: 8
                            TitleText { text: "3. Add the Chrome extension"; font.pixelSize: 13 }
                            BodyText { text: "Open chrome://extensions, enable Developer mode, then Load unpacked and select the extension folder." }
                            ActionButton { text: "Show extension folder"; symbol: "folder"; onClicked: backend.openExtensionFolder() }
                        }
                    }
                    ActionButton { text: "Start downloading"; primary: true; Layout.fillWidth: true; implicitHeight: 38; onClicked: backend.finishSetup() }
                    BodyText { text: "Reddit is enabled by default. You can manage websites in the extension."; font.pixelSize: 11; color: Theme.dim }
                }
            }
        }

        ColumnLayout {
            visible: backend.setupComplete && !window.settingsOpen
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                contentWidth: availableWidth
                ColumnLayout {
                    width: parent.width
                    ColumnLayout {
                        Layout.margins: 16
                        Layout.fillWidth: true
                        spacing: 20
                        Card {
                            implicitHeight: statusCard.implicitHeight + 28
                            ColumnLayout {
                                id: statusCard
                                anchors { fill: parent; margins: 14 }
                                spacing: 14
                                RowLayout {
                                    spacing: 12
                                    Rectangle { width: 10; height: 10; radius: 5; Layout.leftMargin: 2; color: backend.browserCount > 0 && backend.accepting ? Theme.accent : "transparent"; border.color: backend.browserCount > 0 ? Theme.accent : Theme.dim; border.width: 1.5 }
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 3
                                        TitleText { text: window.connectionTitle; font.pixelSize: 17 }
                                        BodyText { text: window.connectionDetail; font.pixelSize: 11 }
                                    }
                                }
                                ActionButton {
                                    Layout.fillWidth: true
                                    text: backend.browserCount > 0 ? (backend.accepting ? "Pause new downloads" : "Accept new downloads") : "Extension setup"
                                    symbol: backend.browserCount > 0 ? (backend.accepting ? "pause" : "play") : "link"
                                    primary: !backend.accepting || backend.browserCount === 0
                                    onClicked: { if (backend.browserCount > 0) backend.accepting = !backend.accepting; else window.settingsOpen = true }
                                }
                            }
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 8
                            RowLayout {
                                SectionLabel { text: "Current downloads"; Layout.fillWidth: true }
                                Text { visible: backend.queuedCount > 0; text: backend.queuedCount + " queued"; color: Theme.dim; font.pixelSize: 11 }
                            }
                            Rectangle {
                                visible: backend.downloadCount === 0
                                Layout.fillWidth: true
                                implicitHeight: 88
                                radius: Theme.radius
                                color: "transparent"
                                border.color: Theme.edge
                                RowLayout {
                                    anchors { fill: parent; margins: 14 }
                                    spacing: 12
                                    Icon { name: "tray"; color: Theme.dim; width: 22; height: 22 }
                                    ColumnLayout {
                                        spacing: 4
                                        TitleText { text: "Ready when you are"; font.pixelSize: 13 }
                                        BodyText { text: "Click the download button on an image in Chrome."; font.pixelSize: 12 }
                                    }
                                }
                            }
                            Repeater { model: backend.downloads; DownloadCard { required property var modelData; job: modelData; Layout.fillWidth: true } }
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 3
                            RowLayout {
                                SectionLabel { text: "Recent"; Layout.fillWidth: true }
                                ActionButton { visible: backend.recentCount > 0; text: "Clear"; ghost: true; implicitHeight: 26; onClicked: backend.clearHistory() }
                            }
                            BodyText { visible: backend.recentCount === 0; text: "Saved images will appear here."; color: Theme.dim; Layout.topMargin: 5 }
                            Repeater {
                                model: backend.recent
                                Rectangle {
                                    id: recentRow
                                    required property var modelData
                                    Layout.fillWidth: true
                                    implicitHeight: 54
                                    radius: 6
                                    color: hover.hovered ? Theme.surface : "transparent"
                                    HoverHandler { id: hover }
                                    RowLayout {
                                        anchors { fill: parent; leftMargin: 2; rightMargin: 2 }
                                        spacing: 10
                                        Icon { name: ["completed", "skipped"].includes(recentRow.modelData.state) ? "image" : "alert"; color: Theme.dim }
                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 3
                                            Text { text: recentRow.modelData.name; Layout.fillWidth: true; elide: Text.ElideMiddle; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 12; textFormat: Text.PlainText }
                                            Text { text: recentRow.modelData.detail; Layout.fillWidth: true; elide: Text.ElideRight; color: Theme.dim; font.pixelSize: 11; textFormat: Text.PlainText }
                                        }
                                        ActionButton { visible: ["completed", "skipped"].includes(recentRow.modelData.state); symbol: "search"; hint: "Show in folder"; ghost: true; onClicked: backend.reveal(recentRow.modelData.jobId) }
                                        ToolTip.visible: hover.hovered && recentRow.modelData.state === "failed"
                                        ToolTip.text: recentRow.modelData.detail
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; height: 1; gradient: Gradient { orientation: Gradient.Horizontal; GradientStop { position: 0; color: "transparent" } GradientStop { position: 0.15; color: Theme.edge } GradientStop { position: 0.85; color: Theme.edge } GradientStop { position: 1; color: "transparent" } } }
            RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: 16
                Layout.rightMargin: 12
                Layout.topMargin: 6
                Layout.bottomMargin: 6
                spacing: 8
                Icon { name: "folder"; width: 15; height: 15 }
                Text { text: backend.saveFolder; Layout.fillWidth: true; elide: Text.ElideMiddle; color: Theme.muted; font.pixelSize: 11; textFormat: Text.PlainText }
                ActionButton { text: "Open folder"; ghost: true; onClicked: backend.openFolder() }
            }
        }

        ColumnLayout {
            visible: window.settingsOpen
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                contentWidth: availableWidth
                ColumnLayout {
                    width: parent.width
                    ColumnLayout {
                        Layout.margins: 16
                        Layout.fillWidth: true
                        spacing: 18
                        SectionLabel { text: "Appearance" }
                        Card {
                            implicitHeight: appearanceSettings.implicitHeight + 24
                            ColumnLayout {
                                id: appearanceSettings
                                anchors { fill: parent; margins: 12 }
                                spacing: 12
                                TitleText { text: "Palette"; font.pixelSize: 13 }
                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 5
                                    Repeater {
                                        model: [{name: "Teal", value: "teal"}, {name: "Blurple", value: "blurple"}, {name: "Blue", value: "blue"}, {name: "Grey", value: "grey"}]
                                        ActionButton {
                                            required property var modelData
                                            objectName: "palette_" + modelData.value
                                            text: modelData.name; implicitWidth: 64; Layout.fillWidth: true
                                            primary: backend.themePalette === modelData.value
                                            onClicked: backend.themePalette = modelData.value
                                        }
                                    }
                                }
                                TitleText { text: "Color scheme"; font.pixelSize: 13 }
                                RowLayout {
                                    spacing: 5
                                    Repeater {
                                        model: [{name: "Dark", value: "dark"}, {name: "Light", value: "light"}, {name: "System", value: "system"}]
                                        ActionButton {
                                            required property var modelData
                                            objectName: "scheme_" + modelData.value
                                            text: modelData.name; primary: backend.colorScheme === modelData.value
                                            onClicked: backend.colorScheme = modelData.value
                                        }
                                    }
                                }
                                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.inset }
                                RowLayout {
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        TitleText { text: "Integrated title bar"; font.pixelSize: 13 }
                                        BodyText { text: "Blend the window header into the app. Applies after restarting."; font.pixelSize: 11 }
                                    }
                                    Toggle {
                                        objectName: "customTitleBarToggle"
                                        checked: backend.customTitleBar
                                        Accessible.name: "Integrated title bar"
                                        onToggled: backend.customTitleBar = checked
                                    }
                                }
                                BodyText {
                                    visible: backend.customTitleBar !== window.customChrome
                                    text: "Restart QDownloadManager to apply the title bar change."
                                    font.pixelSize: 11
                                    color: Theme.accentText
                                }
                            }
                        }
                        SectionLabel { text: "Chrome connection" }
                        Card {
                            implicitHeight: connectionSettings.implicitHeight + 24
                            ColumnLayout {
                                id: connectionSettings
                                anchors { fill: parent; margins: 12 }
                                spacing: 10
                                TitleText { text: backend.bridgeInstalled ? "Local bridge registered" : "Set up the local bridge"; font.pixelSize: 13 }
                                BodyText { text: "Chrome talks to this app on the same computer. Keep the app running while saving images." }
                                ActionButton { text: backend.bridgeInstalled ? "Register again" : "Register Chrome bridge"; symbol: "link"; onClicked: backend.installBridge() }
                                BodyText { text: "In chrome://extensions, turn on Developer mode and load the unpacked extension folder. Then open its popup and click Connect."; font.pixelSize: 11 }
                                ActionButton { text: "Show extension folder"; symbol: "folder"; onClicked: backend.openExtensionFolder() }
                            }
                        }
                        SectionLabel { text: "Downloads" }
                        Card {
                            implicitHeight: downloadSettings.implicitHeight + 24
                            ColumnLayout {
                                id: downloadSettings
                                anchors { fill: parent; margins: 12 }
                                spacing: 14
                                RowLayout {
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 4
                                        TitleText { text: "Save to"; font.pixelSize: 13 }
                                        BodyText { text: backend.saveFolder; font.pixelSize: 11; maximumLineCount: 2; elide: Text.ElideMiddle }
                                    }
                                    ActionButton { text: "Change…"; onClicked: folderDialog.open() }
                                }
                                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.inset }
                                TitleText { text: "If the filename already exists"; font.pixelSize: 13 }
                                RowLayout {
                                    ActionButton { text: "Skip"; primary: backend.existingFilePolicy === "skip"; onClicked: backend.existingFilePolicy = "skip" }
                                    ActionButton { text: "Overwrite"; primary: backend.existingFilePolicy === "overwrite"; onClicked: backend.existingFilePolicy = "overwrite" }
                                }
                                BodyText {
                                    text: backend.existingFilePolicy === "skip"
                                        ? "Keep the existing file and skip the download. Checks the save folder above."
                                        : "Replace the file only after the new download finishes successfully."
                                    font.pixelSize: 11
                                }
                                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.inset }
                                RowLayout {
                                    BodyText { text: "Downloads at once"; color: Theme.text; font.pixelSize: 13 }
                                    DownloadSpinBox {
                                        objectName: "downloadConcurrency"
                                        value: backend.concurrency
                                        onValueModified: backend.concurrency = value
                                    }
                                }
                            }
                        }
                        SectionLabel { text: "Behavior" }
                        Card {
                            implicitHeight: behaviorSettings.implicitHeight + 24
                            ColumnLayout {
                                id: behaviorSettings
                                anchors { fill: parent; margins: 12 }
                                spacing: 12
                                RowLayout {
                                    ColumnLayout { Layout.fillWidth: true; spacing: 3; TitleText { text: "Keep running when closed"; font.pixelSize: 13 } BodyText { text: trayAvailable ? "Stay available in the menu bar or system tray." : "A system tray is not available on this desktop."; font.pixelSize: 11 } }
                                    Toggle { checked: backend.keepInTray; enabled: trayAvailable; Accessible.name: "Keep running when closed"; onToggled: backend.keepInTray = checked }
                                }
                                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.inset }
                                RowLayout {
                                    ColumnLayout { Layout.fillWidth: true; spacing: 3; TitleText { text: "Notify when saved"; font.pixelSize: 13 } BodyText { text: "Use system notifications when available."; font.pixelSize: 11 } }
                                    Toggle { checked: backend.notifications; enabled: trayAvailable; Accessible.name: "Notify when saved"; onToggled: backend.notifications = checked }
                                }
                            }
                        }
                        BodyText { text: "Website permissions and the transfer method are managed in the Chrome extension."; color: Theme.dim; font.pixelSize: 11 }
                        RowLayout {
                            BodyText { text: "Version " + backend.version; color: Theme.dim; font.pixelSize: 11 }
                            ActionButton { text: "Quit QDownloadManager"; ghost: true; onClicked: Qt.quit() }
                        }
                    }
                }
            }
        }
        Rectangle {
            visible: backend.message.length > 0
            Layout.fillWidth: true
            implicitHeight: messageRow.implicitHeight + 16
            color: Theme.accentDark
            RowLayout {
                id: messageRow
                anchors { fill: parent; margins: 8 }
                BodyText { text: backend.message; color: Theme.accentText; font.pixelSize: 11 }
                ActionButton { symbol: "close"; hint: "Dismiss message"; ghost: true; onClicked: backend.dismissMessage() }
            }
        }
    }
    FrameResizer { window: window; visible: window.framelessChrome; z: 100 }
}
