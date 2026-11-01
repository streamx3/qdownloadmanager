#include "localendpoint.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QStandardPaths>

QString LocalEndpoint::dataDirectory()
{
    return QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
}

bool LocalEndpoint::prepareDirectory(const QString &path)
{
    if (!QDir().mkpath(path)) return false;
#ifndef Q_OS_WIN
    return QFile::setPermissions(path, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner);
#else
    return true;
#endif
}

QString LocalEndpoint::name(const QString &dataDirectory)
{
    const auto digest = QCryptographicHash::hash(QDir(dataDirectory).absolutePath().toUtf8(), QCryptographicHash::Sha256).toHex().left(20);
#ifdef Q_OS_WIN
    return "qdownloadmanager-" + QString::fromLatin1(digest);
#else
    // A short path avoids Unix socket path-length limits; its private parent also
    // protects macOS, where QLocalServer socket permission flags are ignored.
    const auto directory = QDir::tempPath() + "/qdm-" + QString::fromLatin1(digest);
    const QFileInfo info(directory);
    if (info.exists() && (info.isSymLink() || info.ownerId() != QFileInfo(QDir::homePath()).ownerId())) return {};
    if (!prepareDirectory(directory)) return {};
    return directory + "/app.sock";
#endif
}
