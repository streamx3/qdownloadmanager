#pragma once
#include <QByteArray>
#include <QJsonObject>
#include <QString>

namespace Protocol {
constexpr quint32 MaxFrame = 512 * 1024;
constexpr qsizetype MaxChunk = 192 * 1024;
constexpr qint64 MaxFile = 2LL * 1024 * 1024 * 1024;
QByteArray frame(const QJsonObject &object);
// Returns false for an invalid frame. An empty object means more data is needed.
bool take(QByteArray &buffer, QJsonObject &object, QString &error);
QJsonObject success(const QJsonObject &request, QJsonObject fields = {});
QJsonObject failure(const QJsonObject &request, const QString &code, const QString &message);
bool validRequest(const QJsonObject &object);
}
