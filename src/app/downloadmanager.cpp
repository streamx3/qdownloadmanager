#include "downloadmanager.h"
#include "protocol.h"
#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMimeDatabase>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QSaveFile>
#include <QTimer>
#include <QUuid>
#include <algorithm>
#include <filesystem>

namespace {
bool terminal(const QString &state) { return state == "completed" || state == "failed" || state == "cancelled" || state == "skipped"; }
std::filesystem::path nativePath(const QString &path) {
#ifdef Q_OS_WIN
    return std::filesystem::path(path.toStdWString());
#else
    return std::filesystem::path(QFile::encodeName(path).constData());
#endif
}
qint64 now() { return QDateTime::currentMSecsSinceEpoch(); }
QString bytes(qint64 n) {
    if (n < 0) return QStringLiteral("Unknown size");
    if (n < 1024) return QString::number(n) + " B";
    if (n < 1024 * 1024) return QString::number(n / 1024.0, 'f', 1) + " KB";
    return QString::number(n / (1024.0 * 1024), 'f', 1) + " MB";
}
}

DownloadManager::DownloadManager(const QString &dataDirectory, QObject *parent)
    : QObject(parent), m_dataDirectory(dataDirectory)
{
    loadHistory();
    auto timer = new QTimer(this);
    timer->setInterval(1000);
    connect(timer, &QTimer::timeout, this, [this] {
        bool live = false;
        for (const auto &job : m_jobs) {
            if (job->state == "receiving" && now() - job->lastActivity > 120000)
                stop(job, "failed", "The browser stopped sending data. Try the image again.");
            live |= !terminal(job->state);
        }
        if (live) emit changed();
    });
    timer->start();
}

DownloadManager::~DownloadManager() { shutdown(); }

void DownloadManager::shutdown()
{
    if (m_shuttingDown) return;
    m_shuttingDown = true;
    for (auto timer : findChildren<QTimer *>()) timer->stop();
    for (const auto &job : m_jobs) {
        if (job->reply) {
            QObject::disconnect(job->reply, nullptr, this, nullptr);
            job->reply->abort();
            job->reply->deleteLater();
            job->reply = nullptr;
        }
        if (!terminal(job->state)) {
            job->state = "failed";
            job->error = "Interrupted when the app closed. Download the image again.";
            job->finishedAt = QDateTime::currentDateTime().toString(Qt::ISODate);
        }
        job->file.reset();
    }
    saveHistory();
    emit changed();
}

bool DownloadManager::validUrl(const QString &text)
{
    const QUrl url(text, QUrl::StrictMode);
    return text.size() <= 16384 && url.isValid() && !url.host().isEmpty()
        && (url.scheme() == "https" || url.scheme() == "http") && url.userInfo().isEmpty();
}

QString DownloadManager::safeName(QString name, const QString &mime)
{
    name.replace('\\', '/');
    name = name.section('/', -1).trimmed();
    name.replace(QRegularExpression("[\\x00-\\x1f\\x7f<>:\"/\\\\|?*]"), "_");
    name.remove(QRegularExpression("[. ]+$"));
    if (name.isEmpty() || name == "." || name == "..") name = "image";
    if (QRegularExpression("^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\.|$)", QRegularExpression::CaseInsensitiveOption).match(name).hasMatch())
        name.prepend('_');
    while (name.toUtf8().size() > 180) name.chop(1);
    if (QFileInfo(name).suffix().isEmpty()) {
        const auto suffix = QMimeDatabase().mimeTypeForName(mime.section(';', 0, 0)).preferredSuffix();
        if (!suffix.isEmpty()) name += '.' + suffix;
    }
    return name;
}

DownloadManager::JobPtr DownloadManager::find(const QString &id) const
{
    for (const auto &job : m_jobs) if (job->id == id) return job;
    return {};
}

bool DownloadManager::targetBusy(const QString &path, const QString &exceptId) const
{
    for (const auto &job : m_jobs)
        if (job->id != exceptId && job->path == path && !terminal(job->state)) return true;
    return false;
}

QJsonObject DownloadManager::fileStatus(const QString &name) const
{
    const auto normalized = safeName(name);
    const auto path = QDir(m_folder).absoluteFilePath(normalized);
    const QFileInfo file(path);
    return {{"name", normalized}, {"exists", file.exists() || file.isSymLink()},
            {"busy", targetBusy(path)}, {"policy", m_existingFilePolicy}};
}

bool DownloadManager::skipExisting(const JobPtr &job)
{
    const QFileInfo file(job->path);
    if (job->existingFilePolicy == "skip" && (file.exists() || file.isSymLink())) {
        stop(job, "skipped");
        return true;
    }
    return false;
}

QVariantMap DownloadManager::view(const JobPtr &job) const
{
    const auto speed = job->startedAt > 0 ? job->received * 1000.0 / qMax<qint64>(1, now() - job->startedAt) : 0.0;
    QString detail = job->error;
    if (job->state == "receiving" || job->state == "downloading") detail = bytes(qint64(speed)) + "/s";
    if (job->state == "queued") detail = "Waiting for a download slot";
    if (job->state == "paused") detail = job->mode == "url" ? "Paused · resumes from the beginning" : "Paused";
    if (job->state == "completed") detail = bytes(job->received);
    if (job->state == "cancelled") detail = "Cancelled";
    if (job->state == "skipped") detail = "Already exists · skipped";
    return {{"jobId", job->id}, {"name", job->name}, {"state", job->state}, {"detail", detail},
            {"received", job->received}, {"total", job->total}, {"path", job->path},
            {"bytesLabel", bytes(job->received) + (job->total >= 0 ? " / " + bytes(job->total) : "")},
            {"progress", job->total > 0 ? qMin(1.0, double(job->received) / job->total) : 0.0},
            {"finishedAt", job->finishedAt}};
}

QVariantList DownloadManager::active() const
{
    QVariantList result;
    for (const auto &job : m_jobs) if (!terminal(job->state)) result.append(view(job));
    return result;
}

QVariantList DownloadManager::recent() const
{
    QVariantList result;
    for (auto it = m_jobs.crbegin(); it != m_jobs.crend() && result.size() < 30; ++it)
        if (terminal((*it)->state)) result.append(view(*it));
    return result;
}

int DownloadManager::queuedCount() const
{
    int count = 0;
    for (const auto &job : m_jobs) if (job->state == "queued") ++count;
    return count;
}

void DownloadManager::setConcurrency(int value)
{
    m_concurrency = qBound(1, value, 3);
    schedule();
}

QJsonObject DownloadManager::handle(const QJsonObject &request, const QString &owner)
{
    const auto type = request.value("type").toString();
    auto fail = [&](const QString &code, const QString &message) { return Protocol::failure(request, code, message); };
    if (m_shuttingDown) return fail("app_closing", "Download Helper is closing.");
    if (type == "filesStatus") {
        const auto names = request.value("names").toArray();
        if (!request.value("names").isArray() || names.size() > 64) return fail("invalid_request", "Check at most 64 filenames at a time.");
        QJsonArray files;
        for (const auto &name : names) {
            if (!name.isString() || name.toString().size() > 1024) return fail("invalid_name", "Invalid image filename.");
            files.append(fileStatus(name.toString()));
        }
        return Protocol::success(request, {{"files", files}});
    }
    if (type == "begin" || type == "enqueue") {
        if (!m_accepting) return fail("not_accepting", "New downloads are paused in the desktop app.");
        if (active().size() >= 100) return fail("queue_full", "The download queue is full.");
        const auto url = request.value("url").toString();
        if (!validUrl(url)) return fail("invalid_url", "Only HTTP and HTTPS image URLs are supported.");
        const auto totalValue = request.value("total");
        const double total = totalValue.isUndefined() ? -1 : totalValue.toDouble(-2);
        if (total < -1 || total > Protocol::MaxFile || qint64(total) != total)
            return fail("invalid_size", "The file size must be an integer up to 2 GB.");
        auto job = std::make_shared<Job>();
        job->id = QUuid::createUuid().toString(QUuid::WithoutBraces);
        job->owner = owner;
        job->url = url;
        job->mime = request.value("mime").toString().left(200);
        job->name = safeName(request.value("name").toString(QUrl(url).fileName()), job->mime);
        job->path = QDir(m_folder).absoluteFilePath(job->name);
        job->existingFilePolicy = m_existingFilePolicy;
        if (targetBusy(job->path)) return Protocol::success(request, {{"state", "in_progress"}, {"name", job->name}});
        const auto existing = fileStatus(job->name);
        if (m_existingFilePolicy == "skip" && existing.value("exists").toBool())
            return Protocol::success(request, {{"state", "skipped"}, {"name", job->name}});
        job->mode = type == "begin" ? "browser" : "url";
        job->total = qint64(total);
        job->lastActivity = now();
        // Prune only between requests, never while iterating jobs in stop/schedule.
        while (m_jobs.size() >= 200) {
            const auto old = std::find_if(m_jobs.begin(), m_jobs.end(), [](const auto &j) { return terminal(j->state); });
            if (old == m_jobs.end()) break;
            m_jobs.erase(old);
        }
        m_jobs.push_back(job);
        schedule();
        notify();
        if (job->state == "failed") return fail("write_failed", job->error);
        return Protocol::success(request, {{"jobId", job->id}, {"state", job->state}, {"name", job->name}});
    }
    const auto job = find(request.value("jobId").toString());
    if (!job || job->owner != owner) return fail("unknown_job", "This transfer is no longer available.");
    job->lastActivity = now();
    if (type == "jobStatus")
        return Protocol::success(request, {{"state", job->state}, {"name", job->name}, {"received", double(job->received)}, {"message", job->error}});
    if (type == "abort") {
        if (!terminal(job->state)) stop(job, "failed", request.value("message").toString("The browser transfer was interrupted.").left(300));
        return Protocol::success(request);
    }
    if (job->mode != "browser") return fail("invalid_operation", "This is not a browser transfer.");
    if (terminal(job->state)) return fail("transfer_stopped", job->error.isEmpty() ? "This transfer has ended." : job->error);
    if (type == "metadata") {
        const auto total = request.value("total").toDouble(-2);
        if (job->received != 0 || total < -1 || total > Protocol::MaxFile || qint64(total) != total)
            return fail("invalid_size", "The image size is invalid or exceeds the 2 GB limit.");
        job->total = qint64(total);
        job->mime = request.value("mime").toString().left(200);
        job->name = safeName(job->name, job->mime);
        job->path = QFileInfo(job->path).dir().absoluteFilePath(job->name);
        if (targetBusy(job->path, job->id)) {
            stop(job, "failed", "Another download is already saving this filename.");
            return fail("target_busy", job->error);
        }
        skipExisting(job);
        emit changed();
        return Protocol::success(request, {{"state", job->state}, {"name", job->name}});
    }
    if (type == "chunk") {
        if (job->state != "receiving") return Protocol::success(request, {{"accepted", false}, {"state", job->state}});
        if (!request.value("offset").isDouble() || request.value("offset").toDouble(-1) != job->received)
            return fail("invalid_offset", "Image chunks arrived out of order.");
        const auto encoded = request.value("data").toString().toLatin1();
        if (encoded.isEmpty() || encoded.size() > 4 * ((Protocol::MaxChunk + 2) / 3))
            return fail("invalid_chunk", "The image chunk is empty or too large.");
        const auto decoded = QByteArray::fromBase64Encoding(encoded, QByteArray::AbortOnBase64DecodingErrors);
        if (!decoded || decoded.decoded.isEmpty() || decoded.decoded.size() > Protocol::MaxChunk)
            return fail("invalid_chunk", "The image chunk is not valid base64.");
        if (!write(job, decoded.decoded)) return fail("write_failed", job->error);
        emit changed();
        return Protocol::success(request, {{"accepted", true}, {"received", double(job->received)}});
    }
    if (type == "finish") {
        if (job->state != "receiving") return fail("not_ready", "The transfer is paused or queued.");
        if (request.value("size").toDouble(-1) != job->received || (job->total >= 0 && job->received != job->total)) {
            stop(job, "failed", "The received image size does not match the expected size.");
            return fail("size_mismatch", job->error);
        }
        finish(job);
        if (job->state != "completed" && job->state != "skipped") return fail("write_failed", job->error);
        return Protocol::success(request, {{"name", job->name}, {"state", job->state}});
    }
    return fail("unknown_type", "Unsupported transfer command.");
}

bool DownloadManager::openFile(const JobPtr &job)
{
    if (job->file) return true;
    if (skipExisting(job)) return false;
    const auto folder = QFileInfo(job->path).absolutePath();
    if (folder.isEmpty() || !QDir().mkpath(folder)) {
        stop(job, "failed", "Choose a writable download folder in Settings.");
        return false;
    }
    // Destination and overwrite policy were frozen when this job was accepted.
    job->file = std::make_unique<QTemporaryFile>(QDir(folder).absoluteFilePath(".qdm-XXXXXX.part"));
    if (!job->file->open()) {
        stop(job, "failed", "Cannot write to the download folder: " + job->file->errorString());
        return false;
    }
    return true;
}

void DownloadManager::schedule()
{
    if (m_shuttingDown) return;
    int running = 0;
    for (const auto &job : m_jobs) if (job->state == "downloading" || job->state == "receiving") ++running;
    for (const auto &job : m_jobs) {
        if (running >= m_concurrency) break;
        if (job->state != "queued") continue;
        // Mark before opening; a failed open calls stop(), which schedules asynchronously.
        job->state = job->mode == "browser" ? "receiving" : "downloading";
        if (!openFile(job)) continue;
        job->startedAt = now();
        job->lastActivity = now();
        ++running;
        if (job->mode == "url") startNetwork(job);
    }
    emit changed();
}

bool DownloadManager::write(const JobPtr &job, const QByteArray &data)
{
    if (job->received + data.size() > Protocol::MaxFile || (job->total >= 0 && job->received + data.size() > job->total)) {
        stop(job, "failed", "The file exceeds its declared size or the 2 GB limit.");
        return false;
    }
    if (!job->file || job->file->write(data) != data.size()) {
        stop(job, "failed", "Could not write the image. Check free space and folder permissions.");
        return false;
    }
    job->received += data.size();
    job->lastActivity = now();
    return true;
}

void DownloadManager::startNetwork(const JobPtr &job)
{
    QNetworkRequest request{QUrl(job->url)};
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setTransferTimeout(60000);
    request.setRawHeader("User-Agent", "QDownloadManager/0.1");
    auto reply = m_network.get(request);
    job->reply = reply;
    reply->setReadBufferSize(256 * 1024);
    connect(reply, &QNetworkReply::metaDataChanged, this, [this, job, reply] {
        if (job->reply != reply) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status >= 400) { stop(job, "failed", QString("HTTP %1. Try transferring through Chrome instead.").arg(status)); return; }
        // QNetworkReply may transparently decompress. Enforce the file cap on bytes written.
        if (!reply->hasRawHeader("Content-Encoding")) {
            bool ok;
            const auto size = reply->header(QNetworkRequest::ContentLengthHeader).toLongLong(&ok);
            job->total = ok ? size : -1;
            if (job->total > Protocol::MaxFile) stop(job, "failed", "The file exceeds the 2 GB limit.");
        }
    });
    connect(reply, &QNetworkReply::readyRead, this, [this, job, reply] {
        if (job->reply != reply || job->state != "downloading") return;
        while (reply->bytesAvailable() && job->state == "downloading") {
            if (!write(job, reply->read(Protocol::MaxChunk))) return;
        }
        emit changed();
    });
    connect(reply, &QNetworkReply::finished, this, [this, job, reply] {
        reply->deleteLater();
        if (job->reply != reply || job->state != "downloading") return;
        job->reply = nullptr;
        if (reply->error() != QNetworkReply::NoError) { stop(job, "failed", reply->errorString()); return; }
        while (reply->bytesAvailable()) if (!write(job, reply->read(Protocol::MaxChunk))) return;
        if (job->total >= 0 && job->received != job->total) { stop(job, "failed", "The download ended before the whole file arrived."); return; }
        finish(job);
    });
}

void DownloadManager::finish(const JobPtr &job)
{
    if (!job->file || !job->file->flush()) { stop(job, "failed", "Could not flush the downloaded file to disk."); return; }
    job->file->close();
    if (skipExisting(job)) return;
    const QFileInfo target(job->path);
    bool saved = false;
    if (job->existingFilePolicy == "overwrite") {
        if (target.isSymLink() || (target.exists() && !target.isFile())) {
            stop(job, "failed", "The destination is not a regular file. Choose another filename or folder.");
            return;
        }
        // Same-directory atomic replacement: never delete the original first.
        std::error_code error;
        std::filesystem::rename(nativePath(job->file->fileName()), nativePath(job->path), error);
        saved = !error;
    } else {
        // QFile::rename refuses to replace a file created after our first check.
        saved = QFile::rename(job->file->fileName(), job->path);
        if (!saved && skipExisting(job)) return;
    }
    if (!saved) { stop(job, "failed", "Could not save the image. Check folder permissions and whether the file is in use."); return; }
    job->file->setAutoRemove(false);
    job->file.reset();
    job->state = "completed";
    job->finishedAt = QDateTime::currentDateTime().toString(Qt::ISODate);
    notify();
    emit completed(job->name);
    QTimer::singleShot(0, this, &DownloadManager::schedule);
}

void DownloadManager::stop(const JobPtr &job, const QString &state, const QString &error)
{
    job->state = state;
    job->error = error;
    if (job->reply) {
        auto reply = job->reply;
        job->reply = nullptr;
        reply->abort();
        reply->deleteLater();
    }
    job->file.reset();
    job->finishedAt = QDateTime::currentDateTime().toString(Qt::ISODate);
    notify();
    QTimer::singleShot(0, this, &DownloadManager::schedule);
}

void DownloadManager::disconnectOwner(const QString &owner)
{
    for (const auto &job : m_jobs)
        if (job->owner == owner && job->mode == "browser" && !terminal(job->state))
            stop(job, "failed", "Chrome disconnected before the image finished. Try the image again.");
}

void DownloadManager::cancel(const QString &id)
{
    if (const auto job = find(id); job && !terminal(job->state)) stop(job, "cancelled");
}

void DownloadManager::togglePause(const QString &id)
{
    const auto job = find(id);
    if (!job || terminal(job->state)) return;
    if (job->state == "paused") { job->state = "queued"; schedule(); }
    else {
        job->state = "paused";
        if (job->reply) {
            auto reply = job->reply;
            job->reply = nullptr;
            reply->abort();
            reply->deleteLater();
            job->file.reset();
            job->received = 0;
            job->total = -1;
        }
        schedule();
    }
    notify();
}

void DownloadManager::clearHistory()
{
    m_jobs.erase(std::remove_if(m_jobs.begin(), m_jobs.end(), [](const auto &j) { return terminal(j->state); }), m_jobs.end());
    notify();
}

QString DownloadManager::completedPath(const QString &id) const
{
    const auto job = find(id);
    return job && (job->state == "completed" || job->state == "skipped") ? job->path : QString();
}

void DownloadManager::notify() { saveHistory(); emit changed(); }

void DownloadManager::saveHistory()
{
    QJsonArray array;
    const auto start = m_jobs.size() > 100 ? m_jobs.size() - 100 : 0;
    for (size_t i = start; i < m_jobs.size(); ++i) {
        const auto &job = m_jobs[i];
        array.append(QJsonObject{{"id", job->id}, {"name", job->name}, {"path", job->path}, {"state", job->state},
                                 {"error", job->error}, {"received", double(job->received)}, {"finishedAt", job->finishedAt}});
    }
    QSaveFile file(QDir(m_dataDirectory).filePath("history.json"));
    if (file.open(QIODevice::WriteOnly)) { file.write(QJsonDocument(array).toJson()); file.commit(); }
}

void DownloadManager::loadHistory()
{
    QFile file(QDir(m_dataDirectory).filePath("history.json"));
    if (!file.open(QIODevice::ReadOnly) || file.size() > 1024 * 1024) return;
    const auto array = QJsonDocument::fromJson(file.readAll()).array();
    for (const auto &value : array) {
        const auto record = value.toObject();
        auto job = std::make_shared<Job>();
        job->id = record.value("id").toString();
        job->name = record.value("name").toString();
        job->path = record.value("path").toString();
        job->received = qint64(record.value("received").toDouble());
        job->state = record.value("state").toString();
        job->error = record.value("error").toString();
        job->finishedAt = record.value("finishedAt").toString();
        if (!terminal(job->state)) { job->state = "failed"; job->error = "Interrupted when the app closed. Download the image again."; }
        m_jobs.push_back(job);
        if (m_jobs.size() >= 100) break;
    }
}
