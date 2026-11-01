#include "appcontroller.h"
#include "downloadmanager.h"
#include "protocol.h"
#include "localserver.h"
#include <QJsonArray>
#include <QDir>
#include <QAbstractItemModelTester>
#include <QFile>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QtTest>

class BackendTest : public QObject {
    Q_OBJECT
    static QJsonObject request(const QString &type, QJsonObject fields = {}) {
        fields.insert("v", 1); fields.insert("id", "test"); fields.insert("type", type); return fields;
    }
    static QString begin(DownloadManager &manager, const QString &name = "image.png", qint64 size = -1) {
        return manager.handle(request("begin", {{"url", "https://joyreactor.cc/pics/post/image.png"}, {"name", name}, {"total", double(size)}}), "owner").value("jobId").toString();
    }
    static QJsonObject chunk(DownloadManager &manager, const QString &id, const QByteArray &data, qint64 offset = 0) {
        return manager.handle(request("chunk", {{"jobId", id}, {"data", QString::fromLatin1(data.toBase64())}, {"offset", double(offset)}}), "owner");
    }
private slots:
    void progressKeepsStableModelRows() {
        DownloadListModel model;
        QAbstractItemModelTester tester(&model, QAbstractItemModelTester::FailureReportingMode::QtTest);
        const QVariantMap a{{"jobId", "a"}, {"received", 0}}, b{{"jobId", "b"}, {"received", 0}};
        model.update({a, b});
        QPersistentModelIndex first(model.index(0));
        QSignalSpy removed(&model, &QAbstractItemModel::rowsRemoved);
        QSignalSpy changed(&model, &QAbstractItemModel::dataChanged);
        auto progress = a; progress["received"] = 128;
        model.update({progress, b});
        QCOMPARE(removed.count(), 0); QCOMPARE(changed.count(), 1);
        QVERIFY(first.isValid()); QCOMPARE(first.data(Qt::UserRole).toMap().value("received").toInt(), 128);
        model.update({b, progress}); QVERIFY(first.isValid()); QCOMPARE(first.row(), 1);
        model.update({progress}); QVERIFY(first.isValid()); QCOMPARE(first.row(), 0);
        model.update({}); QVERIFY(!first.isValid());
    }
    void framesHandleFragmentationAndCoalescing() {
        const auto hello = request("hello");
        const auto frame = Protocol::frame(hello);
        QByteArray buffer = frame.left(2);
        QJsonObject object; QString error;
        QVERIFY(Protocol::take(buffer, object, error)); QVERIFY(object.isEmpty());
        buffer += frame.mid(2) + frame;
        QVERIFY(Protocol::take(buffer, object, error)); QCOMPARE(object, hello);
        QVERIFY(Protocol::take(buffer, object, error)); QCOMPARE(object, hello); QVERIFY(buffer.isEmpty());
        quint32 huge = Protocol::MaxFrame + 1;
        buffer = QByteArray(reinterpret_cast<char *>(&huge), 4);
        QVERIFY(!Protocol::take(buffer, object, error));
    }
    void fileNamesCannotEscapeDestination() {
        QCOMPARE(DownloadManager::safeName("../../outside.png"), "outside.png");
        QCOMPARE(DownloadManager::safeName("C:\\temp\\x.png"), "x.png");
        QCOMPARE(DownloadManager::safeName("CON.png"), "_CON.png");
        QCOMPARE(DownloadManager::safeName("..", "image/png"), "image.png");
        QVERIFY(DownloadManager::safeName(QString(200, QChar(0x0416))).toUtf8().size() <= 180);
        QVERIFY(!DownloadManager::validUrl("file:///etc/passwd"));
        QVERIFY(!DownloadManager::validUrl("https://user:pass@example.com/a"));
        QVERIFY(DownloadManager::validUrl("https://img0.joyreactor.com/a.gif"));
    }
    void exactTransferAndSkipAvoidsDuplicateWork() {
        QTemporaryDir directory;
        DownloadManager manager(directory.path()); manager.setFolder(directory.path());
        const QByteArray data("GIF89a\0\xff\x12hello", 14);
        const auto id = begin(manager, "../image.gif", data.size()); QVERIFY(!id.isEmpty());
        QVERIFY(chunk(manager, id, data.left(4)).value("ok").toBool());
        QVERIFY(chunk(manager, id, data.mid(4), 4).value("ok").toBool());
        QVERIFY(manager.handle(request("finish", {{"jobId", id}, {"size", data.size()}}), "owner").value("ok").toBool());
        QFile file(directory.filePath("image.gif")); QVERIFY(file.open(QIODevice::ReadOnly)); QCOMPARE(file.readAll(), data);
        for (const auto &type : {"begin", "enqueue"}) {
            const auto skipped = manager.handle(request(type, {{"url", "https://joyreactor.cc/image.gif"}}), "owner");
            QCOMPARE(skipped.value("state").toString(), "skipped");
            QVERIFY(!skipped.contains("jobId"));
        }
        QCOMPARE(manager.active().size(), 0); QCOMPARE(manager.recent().size(), 1);
        QVERIFY(!QFileInfo::exists(directory.filePath("image (1).gif")));
        const auto status = manager.handle(request("filesStatus", {{"names", QJsonArray{"../../image.gif", "absent.png"}}}), "owner");
        QVERIFY(status.value("files").toArray().at(0).toObject().value("exists").toBool());
        QVERIFY(!status.value("files").toArray().at(1).toObject().value("exists").toBool());
        QCOMPARE(manager.active().size(), 0);
    }
    void overwriteIsAtomicAndCancellationPreservesOriginal() {
        QTemporaryDir directory;
        DownloadManager manager(directory.path()); manager.setFolder(directory.path()); manager.setExistingFilePolicy("overwrite");
        const auto path = directory.filePath("same.png");
        auto read = [&] { QFile file(path); if (!file.open(QIODevice::ReadOnly)) return QByteArray(); return file.readAll(); };
        { QFile file(path); QVERIFY(file.open(QIODevice::WriteOnly)); file.write("original"); }
        auto id = begin(manager, "same.png", 3);
        QVERIFY(chunk(manager, id, "new").value("ok").toBool());
        QCOMPARE(read(), "original");
        manager.cancel(id); QCOMPARE(read(), "original");
        id = begin(manager, "same.png", 4); chunk(manager, id, "bad");
        QVERIFY(!manager.handle(request("finish", {{"jobId", id}, {"size", 3}}), "owner").value("ok").toBool());
        QCOMPARE(read(), "original");
        id = begin(manager, "same.png", 3); chunk(manager, id, "new");
        QVERIFY(manager.handle(request("finish", {{"jobId", id}, {"size", 3}}), "owner").value("ok").toBool());
        QCOMPARE(read(), "new");
        QCOMPARE(QDir(directory.path()).entryList({"*.part"}, QDir::Files | QDir::Hidden).size(), 0);
    }
    void lateCollisionAndDuplicateInFlight() {
        QTemporaryDir directory;
        DownloadManager manager(directory.path()); manager.setFolder(directory.path());
        const auto id = begin(manager, "race.png"); chunk(manager, id, "new");
        auto response = manager.handle(request("begin", {{"url", "https://joyreactor.com/race.png"}}), "other-owner");
        QCOMPARE(response.value("state").toString(), "in_progress"); QVERIFY(!response.contains("jobId"));
        QVERIFY(manager.fileStatus("race.png").value("busy").toBool());
        { QFile file(directory.filePath("race.png")); QVERIFY(file.open(QIODevice::WriteOnly)); file.write("external"); }
        response = manager.handle(request("finish", {{"jobId", id}, {"size", 3}}), "owner");
        QCOMPARE(response.value("state").toString(), "skipped");
        QFile file(directory.filePath("race.png")); QVERIFY(file.open(QIODevice::ReadOnly)); QCOMPARE(file.readAll(), "external");
        QVERIFY(!manager.fileStatus("race.png").value("busy").toBool());
        // A MIME-derived extension is checked before any browser chunks arrive.
        const auto bare = begin(manager, "race");
        response = manager.handle(request("metadata", {{"jobId", bare}, {"total", 3}, {"mime", "image/png"}}), "owner");
        QCOMPARE(response.value("state").toString(), "skipped");
    }
    void queuedJobsKeepTheirDestinationAndPolicy() {
        QTemporaryDir directory;
        DownloadManager manager(directory.path()); manager.setFolder(directory.path()); manager.setConcurrency(1);
        const auto first = begin(manager, "first.png");
        const auto second = begin(manager, "second.png");
        manager.setFolder(directory.filePath("other")); manager.setExistingFilePolicy("overwrite");
        { QFile file(directory.filePath("second.png")); QVERIFY(file.open(QIODevice::WriteOnly)); file.write("keep"); }
        manager.cancel(first);
        QTRY_COMPARE(manager.active().size(), 0);
        QCOMPARE(manager.handle(request("jobStatus", {{"jobId", second}}), "owner").value("state").toString(), "skipped");
        QFile file(directory.filePath("second.png")); QVERIFY(file.open(QIODevice::ReadOnly)); QCOMPARE(file.readAll(), "keep");
        QVERIFY(!QFileInfo::exists(directory.filePath("other/second.png")));
    }
    void shutdownWithLiveClientAndTransfer() {
        QTemporaryDir directory;
        AppController controller(directory.path());
        controller.chooseFolder(QUrl::fromLocalFile(directory.filePath("files"))); controller.finishSetup();
        auto server = std::make_unique<LocalServer>(controller);
        QVERIFY(server->listen(directory.filePath("socket")));
        QLocalSocket client; client.connectToServer(directory.filePath("socket"));
        QVERIFY(client.waitForConnected());
        client.write(Protocol::frame(request("hello"))); client.flush();
        QTRY_COMPARE(controller.browserCount(), 1);
        client.write(Protocol::frame(request("begin", {{"url", "https://joyreactor.cc/active.png"}}))); client.flush();
        QTRY_COMPARE(controller.downloadCount(), 1);
        server.reset(); // Previously crashed in QHash during QLocalServer destruction.
        QCOMPARE(controller.browserCount(), 0); QCOMPARE(controller.downloadCount(), 0);
        controller.shutdown(); controller.shutdown();
        QCOMPARE(QDir(directory.filePath("files")).entryList({"*.part"}, QDir::Files | QDir::Hidden).size(), 0);
    }
    void duplicatePolicyPersists() {
        QTemporaryDir directory;
        { AppController controller(directory.path()); QCOMPARE(controller.existingFilePolicy(), "skip"); controller.setExistingFilePolicy("overwrite"); }
        { AppController controller(directory.path()); QCOMPARE(controller.existingFilePolicy(), "overwrite"); controller.setExistingFilePolicy("invalid"); QCOMPARE(controller.existingFilePolicy(), "overwrite"); }
    }
    void malformedAndForeignChunksCannotWrite() {
        QTemporaryDir directory;
        DownloadManager manager(directory.path()); manager.setFolder(directory.path());
        const auto id = begin(manager);
        auto bad = request("chunk", {{"jobId", id}, {"data", "%%%"}, {"offset", 0}});
        QVERIFY(!manager.handle(bad, "owner").value("ok").toBool());
        bad["data"] = "YWJj";
        QVERIFY(!manager.handle(bad, "another-client").value("ok").toBool());
        QVERIFY(!chunk(manager, id, "abc", 2).value("ok").toBool());
        QVERIFY(chunk(manager, id, "abc").value("ok").toBool());
        QVERIFY(!chunk(manager, id, "abc", 0).value("ok").toBool());
        manager.disconnectOwner("owner");
        QCOMPARE(manager.active().size(), 0);
        QCOMPARE(QDir(directory.path()).entryList({"*.part"}, QDir::Files | QDir::Hidden).size(), 0);
        QCOMPARE(manager.recent().first().toMap().value("state").toString(), "failed");
    }
    void queuePauseCancelAndSizeMismatch() {
        QTemporaryDir directory;
        DownloadManager manager(directory.path()); manager.setFolder(directory.path()); manager.setConcurrency(1);
        const auto first = begin(manager, "first.png", 4);
        const auto second = begin(manager, "second.png", 3);
        QCOMPARE(manager.queuedCount(), 1);
        manager.togglePause(first);
        QCOMPARE(manager.queuedCount(), 0);
        QVERIFY(!chunk(manager, first, "abcd").value("accepted").toBool());
        QVERIFY(chunk(manager, second, "abc").value("accepted").toBool());
        QVERIFY(manager.handle(request("finish", {{"jobId", second}, {"size", 3}}), "owner").value("ok").toBool());
        manager.togglePause(first);
        QVERIFY(chunk(manager, first, "abc").value("accepted").toBool());
        QVERIFY(!manager.handle(request("finish", {{"jobId", first}, {"size", 3}}), "owner").value("ok").toBool());
        QVERIFY(!QFileInfo::exists(directory.filePath("first.png")));
        const auto third = begin(manager, "third.png");
        manager.cancel(third);
        QVERIFY(!chunk(manager, third, "abc").value("ok").toBool());
        QVERIFY(!QFileInfo::exists(directory.filePath("third.png")));
    }
    void historySurvivesRestartAndClearingKeepsFiles() {
        QTemporaryDir directory;
        {
            DownloadManager manager(directory.path()); manager.setFolder(directory.path());
            const auto id = begin(manager); chunk(manager, id, "png");
            QVERIFY(manager.handle(request("finish", {{"jobId", id}, {"size", 3}}), "owner").value("ok").toBool());
            begin(manager, "interrupted.png");
        }
        DownloadManager restored(directory.path());
        QCOMPARE(restored.recent().size(), 2);
        QCOMPARE(restored.recent().first().toMap().value("state").toString(), "failed");
        restored.clearHistory();
        QVERIFY(restored.recent().isEmpty());
        QVERIFY(QFileInfo::exists(directory.filePath("image.png")));
    }
    void setupAndAcceptingGateNewDownloads() {
        QTemporaryDir directory;
        AppController controller(directory.path());
        const auto payload = request("begin", {{"url", "https://joyreactor.cc/image.png"}});
        QCOMPARE(controller.handle(payload, "owner").value("error").toObject().value("code").toString(), "setup_required");
        controller.chooseFolder(QUrl::fromLocalFile(directory.filePath("files")));
        controller.finishSetup();
        QVERIFY(controller.setupComplete());
        controller.setAccepting(false);
        QCOMPARE(controller.handle(payload, "owner").value("error").toObject().value("code").toString(), "not_accepting");
        controller.setAccepting(true);
        QVERIFY(controller.handle(payload, "owner").value("ok").toBool());
    }
};
QTEST_GUILESS_MAIN(BackendTest)
#include "backend_test.moc"
