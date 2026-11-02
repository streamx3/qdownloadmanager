import QtQuick
import QtQuick.Controls

SpinBox {
    id: control
    from: 1
    to: 20
    editable: true
    live: false
    implicitWidth: 116
    implicitHeight: 34
    leftPadding: 32
    rightPadding: 32
    font.family: Theme.fontFamily
    font.pixelSize: 13
    Accessible.name: "Downloads at once"
    validator: IntValidator { bottom: control.from; top: control.to; locale: control.locale.name }
    // Invalid or unfinished edits restore the last committed value.
    valueFromText: function(text, locale) {
        const number = Number.fromLocaleString(locale, text)
        return Number.isInteger(number) && number >= from && number <= to ? number : value
    }
    contentItem: TextInput {
        objectName: "concurrencyInput"
        text: control.displayText
        font: control.font
        color: Theme.text
        selectionColor: Theme.accentDark
        selectedTextColor: Theme.accentText
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        validator: control.validator
        inputMethodHints: Qt.ImhDigitsOnly
        selectByMouse: true
        clip: true
    }
    background: Rectangle {
        radius: Theme.radius
        color: Theme.inset
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? Theme.accent : Theme.edge
    }
    down.indicator: Rectangle {
        objectName: "concurrencyDecrease"
        width: 30; height: control.height
        radius: Theme.radius
        color: control.down.pressed ? Theme.accentDark : control.down.hovered ? Theme.hover : "transparent"
        opacity: control.value > control.from ? 1 : 0.4
        Icon { anchors.centerIn: parent; name: "minimize"; color: Theme.muted }
    }
    up.indicator: Rectangle {
        objectName: "concurrencyIncrease"
        x: control.width - width
        width: 30; height: control.height
        radius: Theme.radius
        color: control.up.pressed ? Theme.accentDark : control.up.hovered ? Theme.hover : "transparent"
        opacity: control.value < control.to ? 1 : 0.4
        Icon { anchors.centerIn: parent; name: "plus"; color: Theme.muted }
    }
}
