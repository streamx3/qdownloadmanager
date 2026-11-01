import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root
    required property var job
    color: Theme.surface
    radius: Theme.radius
    implicitHeight: contents.implicitHeight + 24
    ColumnLayout {
        id: contents
        anchors { fill: parent; margins: 12 }
        spacing: 10
        RowLayout {
            spacing: 10
            Rectangle { width: 32; height: 32; radius: 7; color: Theme.inset; Icon { anchors.centerIn: parent; name: "image" } }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 3
                Text { text: root.job.name; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideMiddle }
                Text { text: root.job.bytesLabel; color: Theme.muted; font.family: Theme.fontFamily; font.pixelSize: 11 }
            }
            ActionButton { symbol: root.job.state === "paused" ? "play" : "pause"; hint: root.job.state === "paused" ? "Resume download" : "Pause download"; ghost: true; onClicked: backend.togglePause(root.job.jobId) }
            ActionButton { symbol: "close"; hint: "Cancel download"; ghost: true; onClicked: backend.cancel(root.job.jobId) }
        }
        ProgressBar {
            id: progress
            Layout.fillWidth: true
            implicitHeight: 4
            value: root.job.progress
            indeterminate: root.job.total < 0 && root.job.state !== "paused" && root.job.state !== "queued"
            background: Rectangle { radius: 2; color: Theme.inset }
            contentItem: Item {
                clip: true
                Rectangle {
                    width: progress.indeterminate ? parent.width * 0.3 : parent.width * progress.position
                    height: parent.height; radius: 2; color: root.job.state === "paused" ? Theme.dim : Theme.accent
                    SequentialAnimation on x { running: progress.indeterminate; loops: Animation.Infinite; NumberAnimation { from: -100; to: progress.width; duration: 1300 } }
                }
            }
        }
        RowLayout {
            Text { text: root.job.detail; color: Theme.muted; font.family: Theme.fontFamily; font.pixelSize: 11; Layout.fillWidth: true; elide: Text.ElideRight }
            Text { text: root.job.total > 0 ? Math.floor(root.job.progress * 100) + "%" : ""; color: Theme.muted; font.pixelSize: 11 }
        }
    }
}
