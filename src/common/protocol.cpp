#include "protocol.h"
#include <QJsonDocument>
#include <cstring>

QByteArray Protocol::frame(const QJsonObject &object)
{
    const auto json = QJsonDocument(object).toJson(QJsonDocument::Compact);
    if (json.size() > MaxFrame) return {};
    const quint32 length = quint32(json.size());
    QByteArray result(reinterpret_cast<const char *>(&length), sizeof(length));
    result.append(json);
    return result;
}

bool Protocol::take(QByteArray &buffer, QJsonObject &object, QString &error)
{
    object = {};
    if (buffer.size() < 4) return true;
    quint32 length;
    std::memcpy(&length, buffer.constData(), 4);
    if (!length || length > MaxFrame) {
        error = QStringLiteral("Message size is outside the supported limit.");
        return false;
    }
    if (buffer.size() < 4 + qsizetype(length)) return true;
    QJsonParseError parseError;
    const auto document = QJsonDocument::fromJson(buffer.mid(4, length), &parseError);
    buffer.remove(0, 4 + length);
    if (parseError.error != QJsonParseError::NoError || !document.isObject() || document.object().isEmpty()) {
        error = QStringLiteral("Expected a nonempty JSON object.");
        return false;
    }
    object = document.object();
    return true;
}

QJsonObject Protocol::success(const QJsonObject &request, QJsonObject fields)
{
    fields.insert("v", 1);
    fields.insert("id", request.value("id"));
    fields.insert("ok", true);
    return fields;
}

QJsonObject Protocol::failure(const QJsonObject &request, const QString &code, const QString &message)
{
    return {{"v", 1}, {"id", request.value("id")}, {"ok", false},
            {"error", QJsonObject{{"code", code}, {"message", message}}}};
}

bool Protocol::validRequest(const QJsonObject &object)
{
    return object.value("v").toInt() == 1 && object.value("id").isString()
        && !object.value("id").toString().isEmpty() && object.value("id").toString().size() <= 100
        && object.value("type").isString();
}
