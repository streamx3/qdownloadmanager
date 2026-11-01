import QtQuick

Canvas {
    id: root
    property string name: "download"
    property color color: Theme.muted
    implicitWidth: 18
    implicitHeight: 18
    onNameChanged: requestPaint()
    onColorChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onPaint: {
        const c = getContext("2d")
        c.reset(); c.scale(width / 24, height / 24)
        c.strokeStyle = color; c.lineWidth = 1.65; c.lineCap = "round"; c.lineJoin = "round"
        function line(points) { c.beginPath(); c.moveTo(points[0], points[1]); for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i+1]); c.stroke() }
        if (name === "download") { line([12,3,12,16]); line([7,11,12,16,17,11]); line([4,19,20,19]) }
        else if (name === "close") { line([6,6,18,18]); line([18,6,6,18]) }
        else if (name === "minimize") line([5,12,19,12])
        else if (name === "maximize") line([5,5,19,5,19,19,5,19,5,5])
        else if (name === "restore") { line([8,5,19,5,19,16]); line([5,8,16,8,16,19,5,19,5,8]) }
        else if (name === "sun") {
            c.beginPath(); c.arc(12,12,4,0,Math.PI*2); c.stroke()
            for(let a=0;a<8;a++){const t=a*Math.PI/4; line([12+7*Math.cos(t),12+7*Math.sin(t),12+10*Math.cos(t),12+10*Math.sin(t)])}
        }
        else if (name === "moon") {
            c.beginPath(); c.arc(12,12,8,0,Math.PI*1.5)
            c.bezierCurveTo(8,10,14,16,20,12)
            c.closePath(); c.stroke()
        }
        else if (name === "pause") { line([8,5,8,19]); line([16,5,16,19]) }
        else if (name === "play") line([8,5,19,12,8,19,8,5])
        else if (name === "back") { line([14,5,7,12,14,19]); line([7,12,21,12]) }
        else if (name === "check") line([5,12,10,17,20,6])
        else if (name === "plus") { line([12,5,12,19]); line([5,12,19,12]) }
        else if (name === "folder") line([3,7,10,7,12,9,21,9,21,20,3,20,3,5,9,5,11,7])
        else if (name === "image") { line([3,4,21,4,21,20,3,20,3,4]); line([4,17,9,12,13,16,16,13,21,18]); c.beginPath(); c.arc(15,9,1.5,0,Math.PI*2); c.stroke() }
        else if (name === "search") { c.beginPath(); c.arc(10,10,6,0,Math.PI*2); c.stroke(); line([15,15,21,21]) }
        else if (name === "link") { line([9,15,15,9]); c.beginPath(); c.arc(15,8,5,Math.PI,Math.PI*2.5); c.stroke(); c.beginPath(); c.arc(9,16,5,0,Math.PI*1.5); c.stroke() }
        else if (name === "settings") { c.beginPath(); c.arc(12,12,7,0,Math.PI*2); c.stroke(); c.beginPath(); c.arc(12,12,2.5,0,Math.PI*2); c.stroke(); for(let a=0;a<6;a++){ const t=a*Math.PI/3; line([12+7*Math.cos(t),12+7*Math.sin(t),12+10*Math.cos(t),12+10*Math.sin(t)]) } }
        else if (name === "tray") { line([3,8,7,8,9,13,15,13,17,8,21,8,21,20,3,20,3,8]); line([7,4,17,4]) }
        else { c.beginPath(); c.arc(12,12,8,0,Math.PI*2); c.stroke(); line([12,7,12,13]); line([12,17,12,17.1]) }
    }
}
