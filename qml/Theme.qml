pragma Singleton
import QtQuick

QtObject {
    readonly property color background: "#161826"
    readonly property color bottom: "#12131f"
    readonly property color surface: "#232532"
    readonly property color text: "#e9e9ed"
    readonly property color muted: "#b2b6ca"
    readonly property color dim: "#9397ab"
    readonly property color edge: "#3f424d"
    readonly property color inset: "#292b31"
    readonly property color accent: "#9184d9"
    readonly property color accentText: "#d2cefd"
    readonly property color accentDark: "#2b2741"
    readonly property color hover: "#303141"
    readonly property int radius: 8
    readonly property string fontFamily: Qt.fontFamilies().indexOf("Inter") >= 0 ? "Inter" : Qt.application.font.family
}
