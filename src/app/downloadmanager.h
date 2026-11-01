#pragma once
#include <QObject>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QTemporaryFile>
#include <QVariantList>
#include <memory>
#include <vector>

class QNetworkReply;

class DownloadManager : public QObject {
    Q_OBJECT
public:
    explicit DownloadManager(const QString &dataDirectory, QObject *parent = nullptr);
    ~DownloadManager() override;
    void shutdown();
    void setFolder(const QString &folder) { m_folder = folder; }
    void setConcurrency(int value);
    void setAccepting(bool value) { m_accepting = value; }
    void setExistingFilePolicy(const QString &policy) { m_existingFilePolicy = policy == "overwrite" ? policy : "skip"; }
    QVariantList active() const;
    QVariantList recent() const;
    int queuedCount() const;
    QJsonObject handle(const QJsonObject &request, const QString &owner);
    void disconnectOwner(const QString &owner);
    void cancel(const QString &id);
    void togglePause(const QString &id);
    void clearHistory();
    QString completedPath(const QString &id) const;
    static QString safeName(QString name, const QString &mime = {});
    static bool validUrl(const QString &text);
    QJsonObject fileStatus(const QString &name) const;
signals:
    void changed();
    void completed(const QString &name);
private:
    struct Job {
        QString id, owner, name, url, path, mime, state = "queued", error, mode;
        QString finishedAt;
        QString existingFilePolicy;
        qint64 received = 0, total = -1, lastActivity = 0, startedAt = 0;
        std::unique_ptr<QTemporaryFile> file;
        QNetworkReply *reply = nullptr;
    };
    using JobPtr = std::shared_ptr<Job>;
    JobPtr find(const QString &id) const;
    bool targetBusy(const QString &path, const QString &exceptId = {}) const;
    bool skipExisting(const JobPtr &job);
    QVariantMap view(const JobPtr &job) const;
    void schedule();
    bool openFile(const JobPtr &job);
    void startNetwork(const JobPtr &job);
    bool write(const JobPtr &job, const QByteArray &data);
    void finish(const JobPtr &job);
    void stop(const JobPtr &job, const QString &state, const QString &error = {});
    void saveHistory();
    void loadHistory();
    void notify();
    QString m_dataDirectory, m_folder;
    int m_concurrency = 2;
    bool m_accepting = true;
    bool m_shuttingDown = false;
    QString m_existingFilePolicy = "skip";
    QNetworkAccessManager m_network;
    std::vector<JobPtr> m_jobs;
};
