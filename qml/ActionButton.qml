import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Button {
    id: root
    property string symbol: ""
    property bool primary: false
    property bool ghost: false
    property string hint: text
    implicitHeight: 34
    implicitWidth: Math.max(text.length ? 72 : 30, contents.implicitWidth + 22)
    padding: 8
    hoverEnabled: true
    focusPolicy: Qt.StrongFocus
    font.family: Theme.fontFamily
    font.pixelSize: 12
    Accessible.name: hint
    ToolTip.visible: hovered && hint.length > 0 && text.length === 0
    ToolTip.text: hint
    ToolTip.delay: 600
    opacity: enabled ? 1 : 0.4
    background: Rectangle {
        radius: Theme.radius
        color: root.down ? Theme.accentDark : root.hovered ? Theme.hover : "transparent"
        border.width: root.activeFocus ? 2 : 1
        border.color: root.activeFocus || root.primary ? Theme.accent : root.ghost ? "transparent" : Theme.edge
    }
    contentItem: RowLayout {
        id: contents
        spacing: 6
        Icon { visible: root.symbol.length > 0; name: root.symbol; color: root.primary ? Theme.accentText : Theme.muted; Layout.alignment: Qt.AlignHCenter }
        Text { visible: root.text.length > 0; text: root.text; font: root.font; color: root.primary || root.ghost ? Theme.accentText : Theme.text; horizontalAlignment: Text.AlignHCenter; Layout.fillWidth: true }
    }
}
