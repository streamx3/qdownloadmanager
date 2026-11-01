#pragma once
#include <QString>

namespace LocalEndpoint {
QString dataDirectory();
QString name(const QString &dataDirectory);
bool prepareDirectory(const QString &path);
}
