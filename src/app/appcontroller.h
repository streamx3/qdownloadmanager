#pragma once
#include "downloadmanager.h"
#include "downloadlistmodel.h"
#include <QSettings>
#include <QUrl>

class AppController : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString themePalette READ themePalette WRITE setThemePalette NOTIFY settingsChanged)
    Q_PROPERTY(QString colorScheme READ colorScheme WRITE setColorScheme NOTIFY settingsChanged)
    Q_PROPERTY(bool customTitleBar READ customTitleBar WRITE setCustomTitleBar NOTIFY settingsChanged)
    Q_PROPERTY(QString saveFolder READ saveFolder NOTIFY settingsChanged)
    Q_PROPERTY(bool setupComplete READ setupComplete NOTIFY settingsChanged)
    Q_PROPERTY(bool accepting READ accepting WRITE setAccepting NOTIFY settingsChanged)
    Q_PROPERTY(int concurrency READ concurrency WRITE setConcurrency NOTIFY settingsChanged)
    Q_PROPERTY(QString existingFilePolicy READ existingFilePolicy WRITE setExistingFilePolicy NOTIFY settingsChanged)
    Q_PROPERTY(bool keepInTray READ keepInTray WRITE setKeepInTray NOTIFY settingsChanged)
    Q_PROPERTY(bool notifications READ notifications WRITE setNotifications NOTIFY settingsChanged)
    Q_PROPERTY(bool bridgeInstalled READ bridgeInstalled NOTIFY settingsChanged)
    Q_PROPERTY(QString extensionId READ extensionId CONSTANT)
    Q_PROPERTY(QString version READ version CONSTANT)
    Q_PROPERTY(int browserCount READ browserCount NOTIFY connectionChanged)
    Q_PROPERTY(QString serverError READ serverError NOTIFY connectionChanged)
    Q_PROPERTY(QAbstractItemModel* downloads READ downloads CONSTANT)
    Q_PROPERTY(QAbstractItemModel* recent READ recent CONSTANT)
    Q_PROPERTY(int downloadCount READ downloadCount NOTIFY downloadsChanged)
    Q_PROPERTY(int recentCount READ recentCount NOTIFY downloadsChanged)
    Q_PROPERTY(int queuedCount READ queuedCount NOTIFY downloadsChanged)
    Q_PROPERTY(QString message READ message NOTIFY messageChanged)
public:
    explicit AppController(const QString &dataDirectory, QObject *parent = nullptr);
    ~AppController() override;
    void shutdown();
    QString themePalette() const;
    QString colorScheme() const;
    bool customTitleBar() const;
    void setThemePalette(const QString &value);
    void setColorScheme(const QString &value);
    void setCustomTitleBar(bool value);
    QString saveFolder() const;
    bool setupComplete() const;
    bool accepting() const;
    int concurrency() const;
    QString existingFilePolicy() const;
    bool keepInTray() const;
    bool notifications() const;
    bool bridgeInstalled() const;
    QString extensionId() const;
    QString version() const;
    int browserCount() const { return m_browserCount; }
    QString serverError() const { return m_serverError; }
    QAbstractItemModel *downloads() { return &m_activeModel; }
    QAbstractItemModel *recent() { return &m_recentModel; }
    int downloadCount() const { return m_activeModel.rowCount(); }
    int recentCount() const { return m_recentModel.rowCount(); }
    int queuedCount() const { return m_downloads.queuedCount(); }
    QString message() const { return m_message; }
    void setAccepting(bool value);
    void setConcurrency(int value);
    void setExistingFilePolicy(const QString &value);
    void setKeepInTray(bool value);
    void setNotifications(bool value);
    void setBrowserCount(int count);
    void setServerError(const QString &error);
    QJsonObject handle(const QJsonObject &request, const QString &owner);
    void disconnectOwner(const QString &owner) { m_downloads.disconnectOwner(owner); }
    Q_INVOKABLE void chooseFolder(const QUrl &url);
    Q_INVOKABLE void finishSetup();
    Q_INVOKABLE void installBridge();
    Q_INVOKABLE void openExtensionFolder();
    Q_INVOKABLE void openFolder();
    Q_INVOKABLE void reveal(const QString &id);
    Q_INVOKABLE void cancel(const QString &id) { m_downloads.cancel(id); }
    Q_INVOKABLE void togglePause(const QString &id) { m_downloads.togglePause(id); }
    Q_INVOKABLE void clearHistory() { m_downloads.clearHistory(); }
    Q_INVOKABLE void addUrl(const QString &url);
    Q_INVOKABLE void dismissMessage();
    void showMessage(const QString &message);
signals:
    void settingsChanged();
    void connectionChanged();
    void downloadsChanged();
    void messageChanged();
    void downloadCompleted(const QString &name);
private:
    QString manifestPath() const;
    QString bridgePath() const;
    QSettings m_settings;
    DownloadManager m_downloads;
    DownloadListModel m_activeModel, m_recentModel;
    QString m_dataDirectory, m_serverError, m_message;
    int m_browserCount = 0;
};
