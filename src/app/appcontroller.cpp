#include "appcontroller.h"
#include "identity.h"
#include "protocol.h"
#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QProcess>
#include <QSaveFile>
#include <QStandardPaths>
#include <QStringList>
#include <QTemporaryFile>

AppController::AppController(const QString &dataDirectory, QObject *parent)
    : QObject(parent), m_settings(QDir(dataDirectory).filePath("settings.ini"), QSettings::IniFormat),
      m_downloads(dataDirectory, this), m_dataDirectory(dataDirectory)
{
    m_downloads.setFolder(saveFolder());
    m_downloads.setConcurrency(concurrency());
    m_downloads.setAccepting(accepting());
    m_downloads.setExistingFilePolicy(existingFilePolicy());
    auto updateModels = [this] {
        m_activeModel.update(m_downloads.active());
        m_recentModel.update(m_downloads.recent());
        emit downloadsChanged();
    };
    connect(&m_downloads, &DownloadManager::changed, this, updateModels);
    updateModels();
    connect(&m_downloads, &DownloadManager::completed, this, &AppController::downloadCompleted);
}

AppController::~AppController()
{
    shutdown();
    QObject::disconnect(&m_downloads, nullptr, this, nullptr);
}

void AppController::shutdown()
{
    // Models must still exist when the manager emits its final update.
    m_downloads.shutdown();
    m_settings.sync();
}

QString AppController::themePalette() const {
    const auto value = m_settings.value("ui/palette", "blurple").toString();
    return QStringList{"teal", "blurple", "blue", "grey"}.contains(value) ? value : "blurple";
}
QString AppController::colorScheme() const {
    const auto value = m_settings.value("ui/colorScheme", "dark").toString();
    return QStringList{"dark", "light", "system"}.contains(value) ? value : "dark";
}
bool AppController::customTitleBar() const { return m_settings.value("ui/customTitleBar", true).toBool(); }
void AppController::setThemePalette(const QString &value) {
    if (!QStringList{"teal", "blurple", "blue", "grey"}.contains(value) || value == themePalette()) return;
    m_settings.setValue("ui/palette", value); emit settingsChanged();
}
void AppController::setColorScheme(const QString &value) {
    if (!QStringList{"dark", "light", "system"}.contains(value) || value == colorScheme()) return;
    m_settings.setValue("ui/colorScheme", value); emit settingsChanged();
}
void AppController::setCustomTitleBar(bool value) { m_settings.setValue("ui/customTitleBar", value); emit settingsChanged(); }

QString AppController::saveFolder() const
{
    auto downloads = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (downloads.isEmpty()) downloads = QDir::homePath();
    return m_settings.value("folder", QDir(downloads).filePath("Download Helper")).toString();
}
bool AppController::setupComplete() const { return m_settings.value("setupComplete", false).toBool(); }
bool AppController::accepting() const { return m_settings.value("accepting", true).toBool(); }
int AppController::concurrency() const { return qBound(1, m_settings.value("concurrency", 2).toInt(), 3); }
QString AppController::existingFilePolicy() const { return m_settings.value("existingFilePolicy").toString() == "overwrite" ? "overwrite" : "skip"; }
bool AppController::keepInTray() const { return m_settings.value("keepInTray", false).toBool(); }
bool AppController::notifications() const { return m_settings.value("notifications", false).toBool(); }
QString AppController::extensionId() const { return Identity::ExtensionId; }
QString AppController::version() const { return Identity::Version; }
void AppController::setAccepting(bool value) { m_settings.setValue("accepting", value); m_downloads.setAccepting(value); emit settingsChanged(); }
void AppController::setConcurrency(int value) { m_settings.setValue("concurrency", qBound(1, value, 3)); m_downloads.setConcurrency(concurrency()); emit settingsChanged(); }
void AppController::setExistingFilePolicy(const QString &value) {
    if (value != "skip" && value != "overwrite") return;
    m_settings.setValue("existingFilePolicy", value);
    m_downloads.setExistingFilePolicy(value);
    emit settingsChanged();
}
void AppController::setKeepInTray(bool value) { m_settings.setValue("keepInTray", value); emit settingsChanged(); }
void AppController::setNotifications(bool value) { m_settings.setValue("notifications", value); emit settingsChanged(); }
void AppController::setBrowserCount(int count) { m_browserCount = count; emit connectionChanged(); }
void AppController::setServerError(const QString &error) { m_serverError = error; emit connectionChanged(); }
void AppController::showMessage(const QString &message) { m_message = message; emit messageChanged(); }
void AppController::dismissMessage() { showMessage({}); }

void AppController::chooseFolder(const QUrl &url)
{
    if (!url.isLocalFile()) { showMessage("Choose a local folder."); return; }
    const auto path = QDir(url.toLocalFile()).absolutePath();
    if (!QDir().mkpath(path)) { showMessage("That folder could not be created."); return; }
    QTemporaryFile probe(QDir(path).filePath(".qdm-write-test-XXXXXX"));
    if (!probe.open()) { showMessage("That folder is not writable. Choose another folder."); return; }
    m_settings.setValue("folder", path);
    m_downloads.setFolder(path);
    emit settingsChanged();
}

void AppController::finishSetup()
{
    chooseFolder(QUrl::fromLocalFile(saveFolder()));
    QTemporaryFile probe(QDir(saveFolder()).filePath(".qdm-write-test-XXXXXX"));
    if (!probe.open()) return;
    m_settings.setValue("setupComplete", true);
    emit settingsChanged();
}

QString AppController::bridgePath() const
{
#ifdef Q_OS_WIN
    return QCoreApplication::applicationDirPath() + "/qdm-native-host.exe";
#else
    return QCoreApplication::applicationDirPath() + "/qdm-native-host";
#endif
}

QString AppController::manifestPath() const
{
#ifdef Q_OS_MACOS
    return QDir::homePath() + "/Library/Application Support/Google/Chrome/NativeMessagingHosts/" + Identity::Host + ".json";
#elif defined(Q_OS_WIN)
    return m_dataDirectory + "/" + Identity::Host + ".json";
#else
    auto config = qEnvironmentVariable("XDG_CONFIG_HOME");
    if (config.isEmpty()) config = QDir::homePath() + "/.config";
    return config + "/google-chrome/NativeMessagingHosts/" + Identity::Host + ".json";
#endif
}

bool AppController::bridgeInstalled() const
{
    QFile file(manifestPath());
    if (!file.open(QIODevice::ReadOnly)) return false;
    const auto object = QJsonDocument::fromJson(file.readAll()).object();
    if (object.value("path").toString() != bridgePath() || !QFileInfo::exists(bridgePath())) return false;
#ifdef Q_OS_WIN
    QSettings registry(QString("HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\%1").arg(Identity::Host), QSettings::NativeFormat);
    return registry.value(".").toString() == QDir::toNativeSeparators(manifestPath());
#else
    return true;
#endif
}

void AppController::installBridge()
{
    if (!QFileInfo::exists(bridgePath())) { showMessage("The native bridge is missing beside the app executable. Rebuild the app first."); return; }
    const QJsonObject manifest{{"name", Identity::Host}, {"description", "Download Helper local bridge"},
        {"path", QDir::toNativeSeparators(bridgePath())}, {"type", "stdio"},
        {"allowed_origins", QJsonArray{"chrome-extension://" + extensionId() + "/"}}};
    QDir().mkpath(QFileInfo(manifestPath()).absolutePath());
    QSaveFile file(manifestPath());
    if (!file.open(QIODevice::WriteOnly) || file.write(QJsonDocument(manifest).toJson()) < 0 || !file.commit()) {
        showMessage("Could not register the Chrome bridge: " + file.errorString()); return;
    }
#ifdef Q_OS_WIN
    QSettings registry(QString("HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\%1").arg(Identity::Host), QSettings::NativeFormat);
    registry.setValue(".", QDir::toNativeSeparators(manifestPath()));
    registry.sync();
    if (registry.status() != QSettings::NoError) { showMessage("Could not register the native host in the Windows registry."); return; }
#endif
    emit settingsChanged();
    showMessage("Chrome bridge registered. Load the extension, then click Connect in its popup.");
}

void AppController::openExtensionFolder()
{
    auto directory = QCoreApplication::applicationDirPath() + "/extension";
    if (!QFileInfo::exists(directory)) directory = QStringLiteral(QDM_EXTENSION_DIR);
    if (!QDesktopServices::openUrl(QUrl::fromLocalFile(directory))) showMessage("The extension folder could not be opened.");
}

void AppController::openFolder()
{
    if (!QDir().mkpath(saveFolder()) || !QDesktopServices::openUrl(QUrl::fromLocalFile(saveFolder()))) showMessage("The download folder could not be opened.");
}

void AppController::reveal(const QString &id)
{
    const auto path = m_downloads.completedPath(id);
    if (path.isEmpty() || !QFileInfo::exists(path)) { showMessage("This file is no longer in its download folder."); return; }
#ifdef Q_OS_MACOS
    QProcess::startDetached("/usr/bin/open", {"-R", path});
#elif defined(Q_OS_WIN)
    QProcess::startDetached("explorer.exe", {"/select,", QDir::toNativeSeparators(path)});
#else
    QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(path).absolutePath()));
#endif
}

void AppController::addUrl(const QString &url)
{
    const auto reply = m_downloads.handle({{"v", 1}, {"id", "manual"}, {"type", "enqueue"}, {"url", url.trimmed()}}, "desktop");
    if (!reply.value("ok").toBool()) showMessage(reply.value("error").toObject().value("message").toString());
    else if (reply.value("state") == "skipped") showMessage("This filename already exists. Download skipped.");
    else if (reply.value("state") == "in_progress") showMessage("This filename is already being downloaded.");
}

QJsonObject AppController::handle(const QJsonObject &request, const QString &owner)
{
    if (!Protocol::validRequest(request)) return Protocol::failure(request, "invalid_request", "Expected protocol v1 and a request ID.");
    const auto type = request.value("type").toString();
    if (type == "hello" || type == "status")
        return Protocol::success(request, {{"appVersion", Identity::Version}, {"accepting", accepting() && setupComplete()},
                                          {"setupComplete", setupComplete()}, {"active", m_downloads.active().size()}});
    if (!setupComplete()) return Protocol::failure(request, "setup_required", "Finish setup in the desktop app first.");
    return m_downloads.handle(request, owner);
}
